import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { Readability } from "@mozilla/readability";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import { randomUUID } from "node:crypto";
const md = new MarkdownIt({ html: false, linkify: true, breaks: false }).use(
  texmath,
  {
    engine: katex,
    delimiters: ["dollars", "brackets"],
    katexOptions: { throwOnError: false, trust: false, output: "mathml" },
  },
);
const window = new JSDOM("").window;
const purify = createDOMPurify(window);
export function markdown(text) {
  return md.render(text);
}
export function cleanHtml(html) {
  return purify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_TAGS: ["semantics", "annotation", "use"],
    ADD_ATTR: ["encoding"],
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "iframe",
      "object",
      "embed",
      "audio",
      "video",
    ],
    FORBID_ATTR: ["style", "srcset"],
    ALLOW_DATA_ATTR: false,
  });
}
const protectedSelector =
  "pre, code, math, svg, .katex, .math, .MathJax, .MathJax_Preview, [data-protected]";
export function createArticle({
  html,
  title,
  source = "",
  kind = "html",
  warning = "",
}) {
  const dom = new JSDOM(`<body>${cleanHtml(html)}</body>`);
  const body = dom.window.document.body;
  for (const el of body.querySelectorAll("[class]")) {
    if (el.closest("svg")) continue;
    const allowed = Array.from(el.classList).filter((c) =>
      /^(katex(?:-display|-mathml|-html)?|math|MathJax(?:_Preview)?|language-[a-z0-9-]+)$/.test(
        c,
      ),
    );
    if (allowed.length)
      el.className.baseVal !== undefined
        ? el.setAttribute("class", allowed.join(" "))
        : (el.className = allowed.join(" "));
    else el.removeAttribute("class");
  }
  for (const el of body.querySelectorAll("[id]"))
    if (!el.closest("svg")) el.removeAttribute("id");
  // Formula representations used by arXiv, MathJax and MathML remain immutable.
  for (const el of body.querySelectorAll("img")) {
    const src = el.getAttribute("src") || "";
    if (
      /^[a-z]+:/i.test(src) &&
      !/^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);)/i.test(src)
    )
      el.removeAttribute("src");
    el.setAttribute("loading", "lazy");
  }
  for (const el of body.querySelectorAll("a")) {
    el.removeAttribute("href");
    el.removeAttribute("target");
  }
  const walker = dom.window.document.createTreeWalker(
    body,
    dom.window.NodeFilter.SHOW_TEXT,
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const units = [];
  for (const node of nodes) {
    if (
      !node.textContent.trim() ||
      node.parentElement.closest(protectedSelector)
    )
      continue;
    const text = node.textContent;
    if (!/[a-zA-Z]{2}/.test(text)) {
      if (/[\p{L}\p{N}]/u.test(text)) {
        const span = dom.window.document.createElement("span");
        span.setAttribute("data-protected", "true");
        span.textContent = text;
        node.replaceWith(span);
      }
      continue;
    }
    // Bound individual units without dropping any source text.
    const pieces = text.match(/[\s\S]{1,3500}(?:\s|$)|[\s\S]{1,3500}/g) || [
      text,
    ];
    const fragment = dom.window.document.createDocumentFragment();
    for (const piece of pieces) {
      const id = `u${units.length}`;
      const span = dom.window.document.createElement("span");
      span.setAttribute("data-unit", id);
      span.textContent = piece;
      units.push({ id, text: piece });
      fragment.append(span);
    }
    node.replaceWith(fragment);
  }
  if (!units.length && kind !== "pdf") throw new Error("NO_ARTICLE_TEXT");
  if (units.length > 20000 || body.textContent.length > 2000000)
    throw new Error("ARTICLE_TOO_LARGE");
  const evidence = [];
  let protectedIndex = 0;
  for (const el of body.querySelectorAll(
    "[data-unit], [data-protected], pre, math, svg, img, .katex, .math, .MathJax",
  )) {
    if (el.parentElement?.closest(protectedSelector)) continue;
    const id = el.getAttribute("data-unit") || `p${protectedIndex++}`;
    if (!el.hasAttribute("data-unit")) el.setAttribute("data-evidence", id);
    const text =
      el.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent ||
      (el.tagName === "IMG"
        ? `[Image: ${el.getAttribute("alt") || "no description supplied"}. Visual content not sent to model.]`
        : el.textContent);
    if (text?.trim()) evidence.push({ id, text });
  }
  return {
    id: randomUUID(),
    title: title || body.querySelector("h1")?.textContent || "Untitled article",
    source,
    kind,
    warning,
    html: body.innerHTML,
    units,
    evidence,
    translations: {},
    locked: [],
    notes: "",
    blog: "",
    report: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export function importText(text, filename = "article.md") {
  const isHtml = /\.html?$/i.test(filename);
  if (isHtml) return importHtml(text, "", filename);
  const html = /\.txt$/i.test(filename)
    ? text
        .split(/\n\s*\n/)
        .map((x) => `<p>${escapeHtml(x)}</p>`)
        .join("")
    : markdown(text);
  return createArticle({
    html,
    title: text.match(/^#\s+(.+)$/m)?.[1] || filename.replace(/\.[^.]+$/, ""),
    kind: isHtml ? "html" : "markdown",
  });
}
export function importHtml(text, url = "", fallback = "Article") {
  const dom = new JSDOM(text, { url: url || "https://local.invalid" });
  // Resolve assets before Readability clones the DOM.
  for (const img of dom.window.document.querySelectorAll("img")) {
    const src = img.getAttribute("src") || img.getAttribute("data-src");
    if (src && url) {
      try {
        img.setAttribute("src", new URL(src, url).href);
      } catch {
        img.removeAttribute("src");
      }
    }
  }
  const title = dom.window.document.title;
  const extracted = new Readability(dom.window.document.cloneNode(true), {
    charThreshold: 100,
    keepClasses: true,
  }).parse();
  return createArticle({
    html:
      extracted?.content ||
      dom.window.document.querySelector("article,main")?.innerHTML ||
      dom.window.document.body.innerHTML,
    title: extracted?.title || title || fallback,
    source: url,
  });
}
export function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export async function importPdf(bytes, filename) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  if (doc.numPages > 250) {
    await doc.destroy();
    throw new Error("PDF_TOO_MANY_PAGES");
  }
  let html = "";
  let extractedCharacters = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const lines = [];
    let line = "";
    for (const item of content.items)
      if ("str" in item) {
        line += item.str + " ";
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
    if (line.trim()) lines.push(line);
    extractedCharacters += lines.join("").trim().length;
    html +=
      `<h2>Page ${n}</h2>` +
      lines.map((l) => `<p>${escapeHtml(l.trim())}</p>`).join("");
  }
  const pages = doc.numPages;
  await doc.destroy();
  const article = createArticle({
    html,
    title: filename.replace(/\.pdf$/i, ""),
    kind: "pdf",
    warning: "PDF_EXTRACTION",
  });
  article.pages = pages;
  if (extractedCharacters < 20) {
    article.units = [];
    article.warning = "PDF_NO_TEXT";
  }
  return article;
}
