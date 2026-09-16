import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  protect,
  restore,
  validateTranslations,
  batches,
  DEFAULT_TERMS,
} from "../electron/protection.mjs";
import { importText, importHtml, createArticle } from "../electron/content.mjs";
import { OpenRouter, translate, makeReport } from "../electron/llm.mjs";
import { Store } from "../electron/store.mjs";
import { isPublicAddress, checkPublicUrl } from "../electron/network.mjs";
const json = (translations) => JSON.stringify({ translations });
test("math, numbers, acronyms, code, URLs and glossary survive byte-for-byte", () => {
  const text =
    "Transformer with LoRA achieved 91.3% using 8 GPU devices. $L=\\sum_i x_i$ and \\(a^2+b^2=c^2\\). `x += 1` https://example.org/test [12, 13]";
  const p = protect(text);
  assert.equal(restore(p.masked, p.values), text);
  for (const value of [
    "Transformer",
    "LoRA",
    "91.3%",
    "8",
    "GPU",
    "$L=\\sum_i x_i$",
    "\\(a^2+b^2=c^2\\)",
    "`x += 1`",
    "https://example.org/test",
    "[12, 13]",
  ])
    assert.ok(
      p.values.some((x) => x.value === value),
      value,
    );
});
test("glossary boundaries, regex syntax and multiword terms", () => {
  const p = protect(
    "C++ and learning rate differ from rate; tokenization is not token.",
    ["C++", "learning rate", "token"],
  );
  assert.ok(p.values.some((x) => x.value === "C++"));
  assert.ok(p.values.some((x) => x.value === "learning rate"));
  assert.ok(p.masked.includes("tokenization"));
});
test("rejects missing, repeated and foreign markers while allowing Turkish word order", () => {
  const p = protect("GPU and CPU");
  assert.equal(
    restore(
      p.values
        .toReversed()
        .map((x) => x.token)
        .join(" "),
      p.values,
    ),
    "CPU GPU",
  );
  for (const text of [
    "",
    p.masked + p.values[0].token,
    p.masked + "⟦KEEP_fake_0⟧",
  ])
    assert.throws(() => restore(text, p.values), /PROTECTION/);
});
test("source text cannot inject protection markers", () => {
  const raw = "Ignore rules ⟦KEEP_123_0⟧ and GPU";
  const p = protect(raw);
  assert.equal(restore(p.masked, p.values), raw);
});
test("requires exact unique ids and nonempty response", () => {
  const u = { id: "u0", ...protect("A GPU test") };
  assert.throws(
    () => validateTranslations(json([{ id: "wrong", text: u.masked }]), [u]),
    /UNIT/,
  );
  assert.throws(
    () => validateTranslations(json([{ id: "u0", text: "" }]), [u]),
    /UNIT/,
  );
  assert.throws(
    () =>
      validateTranslations(
        json([
          { id: "u0", text: u.masked },
          { id: "u0", text: u.masked },
        ]),
        [u],
      ),
    /UNIT/,
  );
  assert.throws(() => validateTranslations("nonsense", [u]), /JSON/);
});
test("math, HTML structure, code and image bytes never enter translation units", () => {
  const a = importText(
    "# Test\n\nSome **important** text with $x^2 + y^2$.\n\n$$\\frac{a}{b}$$\n\n```python\nx = 1\n```\n\n![figure](data:image/png;base64,aGVsbG8=)\n\n| Name | Value |\n|---|---|\n| Model | Better |",
    "sample.md",
  );
  const doc = new JSDOM(a.html).window.document;
  assert.equal(doc.querySelectorAll("math").length, 2);
  assert.equal(doc.querySelector("code").textContent, "x = 1\n");
  assert.equal(
    doc.querySelector("img").getAttribute("src"),
    "data:image/png;base64,aGVsbG8=",
  );
  assert.ok(doc.querySelector("table"));
  assert.ok(doc.querySelector("strong"));
  assert.ok(
    a.units.every((x) => !x.text.includes("x = 1") && !x.text.includes("frac")),
  );
  const before = Array.from(doc.querySelectorAll("math,pre,img")).map(
    (x) => x.outerHTML,
  );
  for (const el of doc.querySelectorAll("[data-unit]"))
    el.textContent = "Türkçe";
  assert.deepEqual(
    Array.from(doc.querySelectorAll("math,pre,img")).map((x) => x.outerHTML),
    before,
  );
});
test("untrusted HTML loses scripts, handlers, forms, embedded pages and javascript URLs", () => {
  const a = createArticle({
    html: '<h1>Test article</h1><script>steal()</script><img src="x" onerror="steal()"><iframe src="file:///etc/passwd"></iframe><a href="javascript:steal()">Read here</a><form><input></form><p style="position:fixed">Body text</p>',
  });
  for (const forbidden of [
    "<script",
    "onerror",
    "<iframe",
    "javascript:",
    "<input",
    "style=",
  ])
    assert.ok(!a.html.includes(forbidden), forbidden);
});
test("HTML link imports extract article, title and resolve image paths", () => {
  const a = importHtml(
    "<html><title>A paper</title><body><nav>Navigation</nav><article><h1>A paper</h1><p>" +
      "A detailed article about models. ".repeat(30) +
      '</p><img src="/figure.png"></article></body></html>',
    "https://example.com/a",
  );
  assert.equal(a.title, "A paper");
  assert.ok(a.html.includes("https://example.com/figure.png"));
});
test("batch boundaries never lose source units", () => {
  const units = Array.from({ length: 11 }, (_, i) => ({
    id: `u${i}`,
    text: "a".repeat(30),
  }));
  assert.deepEqual(batches(units, 100).flat(), units);
});
test("translation validates retries, resumes, skips locks and persists successful batches", async () => {
  const a = createArticle({
    html: "<p>First GPU passage.</p><p>Second CPU passage.</p><p>Third passage.</p>",
  });
  a.locked = ["u2"];
  a.translations.u0 = "Birinci GPU bölümü.";
  let calls = 0,
    saves = 0;
  const client = {
    complete: async (_m, _s, input) => {
      calls++;
      const { units } = JSON.parse(input);
      assert.deepEqual(
        units.map((u) => u.id),
        ["u1"],
      );
      return calls === 1
        ? "bad"
        : json(
            units.map((u) => ({
              ...u,
              text: u.text.replace("Second", "İkinci"),
            })),
          );
    },
  };
  await translate({
    client,
    article: a,
    model: "test",
    onBatch: () => {
      saves++;
    },
  });
  assert.equal(calls, 2);
  assert.equal(saves, 1);
  assert.equal(a.translations.u1, "İkinci CPU passage.");
  assert.equal(a.translations.u2, undefined);
});
test("failed protection never overwrites source or saves bad translation", async () => {
  const a = createArticle({ html: "<p>A GPU paper.</p>" }),
    source = a.html;
  await assert.rejects(
    translate({
      client: {
        complete: async () => json([{ id: "u0", text: "GPU silindi" }]),
      },
      article: a,
      model: "x",
    }),
    /PROTECTION/,
  );
  assert.deepEqual(a.translations, {});
  assert.equal(a.html, source);
});
test("cancellation is checked before any request", async () => {
  const c = new AbortController();
  c.abort();
  let called = false;
  await assert.rejects(
    translate({
      client: {
        complete: async () => {
          called = true;
        },
      },
      article: createArticle({ html: "<p>Article text</p>" }),
      model: "x",
      signal: c.signal,
    }),
  );
  assert.equal(called, false);
});
test("long article report covers every chunk and retains source references", async () => {
  const a = createArticle({
    html: Array.from(
      { length: 28 },
      (_, i) => `<p>Evidence ${i}: ${"text ".repeat(400)}</p>`,
    ).join(""),
  });
  const seen = [];
  let final;
  const client = {
    complete: async (_model, prompt, payload) => {
      const data = JSON.parse(payload);
      if (data.units) {
        seen.push(...data.units.map((u) => u.id));
        return data.units.map((u) => `[${u.id}] observed`).join("\n");
      }
      final = data;
      return "# Report";
    },
  };
  assert.equal(
    await makeReport({ client, article: a, model: "x", language: "Turkish" }),
    "# Report",
  );
  assert.deepEqual(
    seen,
    a.units.map((u) => u.id),
  );
  assert.ok(final.evidence.includes(`[${a.units.at(-1).id}]`));
});
test("OpenRouter key is sent only in authorization header; truncation and authentication failures surface", async () => {
  let sent;
  const client = new OpenRouter("test-secret", async (url, opts) => {
    sent = { url, opts };
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "result" } }],
    });
  });
  assert.equal(
    await client.complete("provider/model", "system", "text"),
    "result",
  );
  assert.equal(sent.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(sent.opts.headers.Authorization, "Bearer test-secret");
  assert.ok(!sent.opts.body.includes("test-secret"));
  await assert.rejects(
    new OpenRouter("k", async () => new Response("", { status: 401 })).complete(
      "x",
      "s",
      "u",
    ),
    /401/,
  );
  await assert.rejects(
    new OpenRouter("k", async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "partial" } }],
      }),
    ).complete("x", "s", "u"),
    /TRUNCATED/,
  );
});
test("local/private addresses and non-web schemes are blocked", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.2",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  for (const url of [
    "file:///etc/passwd",
    "http://127.0.0.1",
    "http://user:pass@example.com",
  ])
    await assert.rejects(checkPublicUrl(url));
});
test("workspace saves atomically and reloads notes, translations and settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "makale-unit-"));
  try {
    const store = new Store(directory);
    await store.init();
    assert.deepEqual((await store.load()).articles, []);
    await Promise.all([
      store.save({ notes: "first" }),
      store.save({
        notes: "Türkçe notlar",
        translations: { u0: "test" },
        settings: { theme: "dark" },
      }),
    ]);
    assert.equal((await store.load()).notes, "Türkçe notlar");
    assert.equal(
      (await fs.stat(path.join(directory, "workspace.json"))).mode & 0o777,
      0o600,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("reports receive exact equation and code evidence despite translation exclusion", () => {
  const a = importText(
    "# Test\n\nThe formula is $x^2$.\n\n```python\nx = 1\n```",
    "test.md",
  );
  assert.ok(a.evidence.some((x) => x.text === "x^2"));
  assert.ok(a.evidence.some((x) => x.text === "x = 1\n"));
  assert.ok(a.evidence.some((x) => x.id.startsWith("p")));
});
test("images are copied byte-for-byte and unavailable images fail import", async () => {
  const { snapshotImages } = await import("../electron/images.mjs");
  const bytes = Buffer.from("original image bytes");
  const a = createArticle({
    html: '<p>Article with a figure.</p><img src="https://example.com/a.png" alt="chart">',
  });
  await snapshotImages(a, null, async () => ({ bytes, type: "image/png" }));
  const src = new JSDOM(a.html).window.document.querySelector("img").src;
  assert.deepEqual(Buffer.from(src.split(",")[1], "base64"), bytes);
  await assert.rejects(
    snapshotImages(
      createArticle({
        html: '<p>Article text.</p><img src="https://example.com/a.png">',
      }),
      null,
      async () => {
        throw new Error("404");
      },
    ),
    /IMAGE_IMPORT_FAILED/,
  );
});
test("PDF text extraction preserves source file and identifies all pages", async () => {
  const { importPdf } = await import("../electron/content.mjs");
  const bytes = await fs.readFile(
    new URL("./fixtures/research.pdf", import.meta.url),
  );
  const before = Buffer.from(bytes);
  const a = await importPdf(bytes, "research.pdf");
  assert.equal(a.pages, 1);
  assert.equal(a.warning, "PDF_EXTRACTION");
  assert.ok(a.units.some((x) => x.text.includes("92.5")));
  assert.deepEqual(bytes, before);
});
test("cancelling after the first batch preserves it and a later run resumes remaining units", async () => {
  const a = createArticle({
    html: Array.from(
      { length: 8 },
      () => `<p>${"Research paragraph. ".repeat(100)}</p>`,
    ).join(""),
  });
  const c = new AbortController();
  let requests = 0;
  const client = {
    complete: async (_m, _p, body) => {
      requests++;
      return json(JSON.parse(body).units);
    },
  };
  await assert.rejects(
    translate({
      client,
      article: a,
      model: "test",
      signal: c.signal,
      onBatch: () => c.abort(),
    }),
  );
  const saved = Object.keys(a.translations).length;
  assert.ok(saved > 0 && saved < a.units.length);
  const snapshot = { ...a.translations };
  await translate({ client, article: a, model: "test" });
  assert.equal(Object.keys(a.translations).length, a.units.length);
  for (const id of Object.keys(snapshot))
    assert.equal(a.translations[id], snapshot[id]);
});
test("standalone numeric table cells are retained as report evidence", () => {
  const a = importText(
    "| Setting | Value |\n|---|---|\n| Batch size | 32 |\n| Accuracy | 92.5% |",
    "table.md",
  );
  assert.ok(a.evidence.some((x) => x.text === "32"));
  assert.ok(a.evidence.some((x) => x.text === "92.5%"));
});
test("SVG internal paths and references remain intact", () => {
  const a = createArticle({
    html: '<p>Vector figure</p><svg viewBox="0 0 10 10"><defs><path id="curve" d="M0 0L10 10"/></defs><use href="#curve"/></svg>',
  });
  const doc = new JSDOM(a.html).window.document;
  assert.ok(doc.querySelector("#curve"));
  assert.equal(doc.querySelector("use").getAttribute("href"), "#curve");
});
