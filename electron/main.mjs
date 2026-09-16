import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
  shell,
  session,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store.mjs";
import { importText, importHtml, importPdf } from "./content.mjs";
import { fetchArticle } from "./network.mjs";
import { OpenRouter, translate, makeReport, makeBlog } from "./llm.mjs";
import { snapshotImages } from "./images.mjs";
import { DEFAULT_TERMS } from "./protection.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.MAKALE_DATA_DIR)
  app.setPath("userData", process.env.MAKALE_DATA_DIR);
const store = new Store(app.getPath("userData"));
let state,
  win,
  job = null,
  key = process.env.OPENROUTER_API_KEY || "";
const secure = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    !["basic_text", "unknown"].includes(
      safeStorage.getSelectedStorageBackend(),
    ));
const keyPath = () => path.join(app.getPath("userData"), "credential.enc");
const idSchema = z.string().uuid();
const getArticle = (id) => {
  idSchema.parse(id);
  const a = state.articles.find((x) => x.id === id);
  if (!a) throw new Error("ARTICLE_NOT_FOUND");
  return a;
};
const persist = () => store.save(state);
function send(p) {
  win?.webContents.send("progress", p);
}
async function addArticle(article, bytes, baseDirectory) {
  await snapshotImages(article, baseDirectory);
  if (bytes) await store.savePdf(article.id, bytes);
  state.articles.unshift(article);
  await persist();
  return article;
}
async function ingest(bytes, name, url = "", baseDirectory) {
  if (bytes.length > 30 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  const text = pdf ? "" : bytes.toString("utf8");
  const a = pdf
    ? await importPdf(bytes, name)
    : url && /<!doctype|<html|<article|<main|<p[ >]|<div[ >]/i.test(text)
      ? importHtml(text, url)
      : importText(text, name);
  if (url) a.source = url;
  return addArticle(a, pdf ? bytes : null, baseDirectory);
}
const handlers = {
  init: () => ({
    ...state,
    keyConfigured: !!key,
    keySecure: secure(),
    defaultTerms: DEFAULT_TERMS,
  }),
  models: () => new OpenRouter(key).models(),
  async settings(args) {
    const value = z
      .object({
        language: z.enum(["en", "tr"]),
        theme: z.enum(["light", "dark", "system"]),
        model: z.string().max(200),
        terms: z.array(z.string().max(150)).max(1000),
      })
      .parse(args);
    state.settings = value;
    await persist();
    return value;
  },
  async key(args) {
    const value = z.string().max(300).parse(args);
    if (value && !/^sk-or-[\w-]+$/.test(value))
      throw new Error("INVALID_API_KEY");
    key = value;
    if (value && secure())
      await fs.writeFile(keyPath(), safeStorage.encryptString(value), {
        mode: 0o600,
      });
    else await fs.rm(keyPath(), { force: true });
    return { keyConfigured: !!key, keySecure: secure() };
  },
  async upload() {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        {
          name: "Articles",
          extensions: ["pdf", "md", "markdown", "txt", "html", "htm"],
        },
      ],
    });
    if (canceled) return null;
    const stat = await fs.stat(filePaths[0]);
    if (stat.size > 30 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
    return ingest(
      await fs.readFile(filePaths[0]),
      path.basename(filePaths[0]),
      "",
      path.dirname(filePaths[0]),
    );
  },
  async paste(args) {
    const { text, title } = z
      .object({
        text: z.string().min(1).max(2000000),
        title: z.string().max(300),
      })
      .parse(args);
    return addArticle(importText(text, (title || "Article") + ".md"));
  },
  async url(args) {
    const url = z.string().url().max(4000).parse(args);
    let target = url;
    const parsed = new URL(url);
    if (
      /^(www\.)?arxiv\.org$/.test(parsed.hostname) &&
      parsed.pathname.startsWith("/abs/")
    )
      target = "https://arxiv.org/html/" + parsed.pathname.slice(5);
    let result;
    try {
      result = await fetchArticle(target);
    } catch (e) {
      if (target !== url && /ARTICLE_HTTP_404/.test(e.message))
        result = await fetchArticle(target.replace("/html/", "/pdf/"));
      else throw e;
    }
    if (!/text\/|application\/(pdf|xhtml)/i.test(result.type) && result.type)
      throw new Error("UNSUPPORTED_CONTENT_TYPE");
    return ingest(
      result.bytes,
      decodeURIComponent(
        new URL(result.url).pathname.split("/").pop() || "Article",
      ),
      result.url,
    );
  },
  async pdf(id) {
    const a = getArticle(id);
    if (a.kind !== "pdf") throw new Error("NOT_PDF");
    return (await store.pdf(id)).toString("base64");
  },
  async edit(args) {
    const { id, ...patch } = z
      .object({
        id: idSchema,
        notes: z.string().max(200000).optional(),
        blog: z.string().max(200000).optional(),
        locked: z.array(z.string()).optional(),
        pdfReviewed: z.boolean().optional(),
      })
      .parse(args);
    const a = getArticle(id);
    if (patch.locked)
      patch.locked = patch.locked.filter((x) =>
        a.units.some((u) => u.id === x),
      );
    Object.assign(a, patch, { updatedAt: new Date().toISOString() });
    await persist();
    return a;
  },
  async remove(id) {
    const a = getArticle(id);
    if (job?.id === id) throw new Error("JOB_RUNNING");
    state.articles = state.articles.filter((x) => x.id !== id);
    await persist();
    if (a.kind === "pdf")
      await fs.rm(path.join(store.directory, `${id}.pdf`), { force: true });
    return true;
  },
  async run(args) {
    const { id, kind, ids } = z
      .object({
        id: idSchema,
        kind: z.enum(["translate", "report", "blog"]),
        ids: z.array(z.string()).optional(),
      })
      .parse(args);
    if (job) throw new Error("JOB_RUNNING");
    if (!key) throw new Error("API_KEY_REQUIRED");
    if (!state.settings.model) throw new Error("MODEL_REQUIRED");
    const article = getArticle(id);
    if (kind === "translate" && article.kind === "pdf" && !article.pdfReviewed)
      throw new Error("PDF_REVIEW_REQUIRED");
    const model = state.settings.model,
      language = state.settings.language === "tr" ? "Turkish" : "English";
    if (
      kind === "report" &&
      !article.units.every(
        (u) => article.translations[u.id] || article.locked.includes(u.id),
      )
    )
      throw new Error("TRANSLATE_FIRST");
    const controller = new AbortController();
    job = { id, controller };
    const opts = {
      client: new OpenRouter(key),
      article,
      model,
      language,
      signal: controller.signal,
      onProgress: (p) => send({ ...p, id }),
      onBatch: async () => {
        article.updatedAt = new Date().toISOString();
        await persist();
        send({ id, article });
      },
    };
    try {
      if (kind === "translate")
        await translate({
          ...opts,
          ids,
          terms: [...DEFAULT_TERMS, ...state.settings.terms],
        });
      if (kind === "report") {
        article.report = await makeReport(opts);
        article.reportModel = model;
        article.reportAt = new Date().toISOString();
      }
      if (kind === "blog") article.blog = await makeBlog(opts);
      article.updatedAt = new Date().toISOString();
      await persist();
      return article;
    } finally {
      job = null;
      send({ id, stage: "idle" });
    }
  },
  cancel() {
    job?.controller.abort();
    return true;
  },
  async export(args) {
    const { id, kind } = z
      .object({
        id: idSchema,
        kind: z.enum(["notes", "blog", "report", "translation", "backup"]),
      })
      .parse(args);
    const a = getArticle(id);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${a.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 80)}-${kind}.${kind === "backup" ? "json" : kind === "translation" ? "html" : "md"}`,
    });
    if (canceled) return false;
    let content;
    if (kind === "backup")
      content = JSON.stringify(
        {
          ...a,
          pdf:
            a.kind === "pdf"
              ? (await store.pdf(id)).toString("base64")
              : undefined,
        },
        null,
        2,
      );
    else if (kind === "translation") {
      const { JSDOM } = await import("jsdom");
      const doc = new JSDOM(a.html).window.document;
      for (const el of doc.querySelectorAll("[data-unit]")) {
        const u = el.getAttribute("data-unit");
        if (a.translations[u] && !a.locked.includes(u))
          el.textContent = a.translations[u];
      }
      const katex = await fs.readFile(
        path.join(here, "../node_modules/katex/dist/katex.min.css"),
        "utf8",
      );
      content = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src data:"><style>${katex}body{max-width:850px;margin:60px auto;font:18px/1.8 serif;padding:24px}img,svg{max-width:100%}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}</style></head><body>${doc.body.innerHTML}</body></html>`;
    } else content = a[kind];
    await fs.writeFile(filePath, content, "utf8");
    return true;
  },
  async openSource(id) {
    const a = getArticle(id);
    if (/^https?:\/\//.test(a.source)) await shell.openExternal(a.source);
    return true;
  },
};
app
  .whenReady()
  .then(async () => {
    await store.init();
    state = await store.load();
    if (!key && secure()) {
      try {
        key = safeStorage.decryptString(await fs.readFile(keyPath()));
      } catch {
        /* User can re-enter unavailable credentials. */
      }
    }
    if (key && secure())
      await fs.writeFile(keyPath(), safeStorage.encryptString(key), {
        mode: 0o600,
      });
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 1500,
      height: 1000,
      minWidth: 1050,
      minHeight: 700,
      title: "Makale",
      backgroundColor: "#f8f9fc",
      icon: path.join(here, "../build/icon.png"),
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) =>
        callback({
          cancel: !(
            process.env.MAKALE_DEV === "1" &&
            details.url.startsWith("http://127.0.0.1:5173/")
          ),
        }),
    );
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    ipcMain.handle("makale", async (event, method, args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("UNTRUSTED_SENDER");
      if (!Object.hasOwn(handlers, method)) throw new Error("UNKNOWN_METHOD");
      try {
        return await handlers[method](args);
      } catch (e) {
        if (e instanceof z.ZodError) throw new Error("INVALID_INPUT");
        throw new Error(
          e.name === "AbortError"
            ? "CANCELLED"
            : e.name === "TimeoutError"
              ? "REQUEST_TIMEOUT"
              : e.message,
        );
      }
    });
    if (process.env.MAKALE_DEV === "1" && !app.isPackaged)
      await win.loadURL("http://127.0.0.1:5173");
    else await win.loadFile(path.join(here, "../dist/index.html"));
    app.on("window-all-closed", () => {
      job?.controller.abort();
      app.quit();
    });
  })
  .catch((error) => {
    console.error(error.message);
    app.quit();
  });
