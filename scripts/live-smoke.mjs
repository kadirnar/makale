// Explicit opt-in: this sends a small fixture to OpenRouter and may incur provider charges.
import fs from "node:fs/promises";
import {
  OpenRouter,
  translate,
  makeReport,
  makeBlog,
} from "../electron/llm.mjs";
import { importText, importHtml } from "../electron/content.mjs";
import { fetchArticle } from "../electron/network.mjs";
if (!process.env.OPENROUTER_API_KEY)
  throw new Error("Set OPENROUTER_API_KEY to run the live smoke test.");
const client = new OpenRouter(process.env.OPENROUTER_API_KEY);
const models = await client.models();
const model = process.env.MAKALE_TEST_MODEL || "google/gemini-2.5-flash-lite";
if (!models.some((m) => m.id === model))
  throw new Error("Smoke-test model unavailable; set MAKALE_TEST_MODEL.");
console.log(`Catalog: ${models.length} text models; testing ${model}`);
const article = importText(
  await fs.readFile(
    new URL("../tests/fixtures/article.md", import.meta.url),
    "utf8",
  ),
  "article.md",
);
await translate({ client, article, model });
console.log(
  `Translation: ${Object.keys(article.translations).length}/${article.units.length} units validated.`,
);
article.report = await makeReport({
  client,
  article,
  model,
  language: "Turkish",
});
console.log(
  `Report: ${article.report.length} characters; evidence references: ${/\[[up]\d+\]/.test(article.report)}`,
);
article.notes =
  "GPU modeli ve veri lisansı belirtilmediği için tekrarlanabilirliği sorguluyorum.";
article.blog = await makeBlog({ client, article, model, language: "Turkish" });
console.log(`Blog: ${article.blog.length} characters.`);
await fs.mkdir(".local", { recursive: true });
await fs.writeFile(
  ".local/live-smoke.json",
  JSON.stringify({ model, article }, null, 2),
  { mode: 0o600 },
);
const remote = await fetchArticle("https://www.paulgraham.com/greatwork.html");
const linked = importHtml(remote.bytes.toString("utf8"), remote.url);
console.log(
  `Live URL import: ${linked.title}, ${linked.units.length} text units.`,
);
