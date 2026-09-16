import {
  TRANSLATION_PROMPT,
  REPORT_PROMPT,
  REPORT_REVIEW_PROMPT,
  EVIDENCE_PROMPT,
  BLOG_PROMPT,
} from "./prompts.mjs";
import {
  protect,
  validateTranslations,
  batches,
  DEFAULT_TERMS,
} from "./protection.mjs";
export class OpenRouter {
  constructor(key, fetcher = fetch) {
    this.key = key;
    this.fetcher = fetcher;
  }
  async models(signal) {
    const r = await this.fetcher("https://openrouter.ai/api/v1/models", {
      signal: signal || AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`OPENROUTER_${r.status}`);
    const { data } = await r.json();
    return data
      .filter(
        (m) => m.architecture?.output_modalities?.includes("text") ?? true,
      )
      .map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
        promptPrice: m.pricing?.prompt,
        completionPrice: m.pricing?.completion,
      }));
  }
  async complete(model, system, content, signal, maxTokens = 7000) {
    if (!this.key) throw new Error("API_KEY_REQUIRED");
    const combined = AbortSignal.any([
      AbortSignal.timeout(180000),
      ...(signal ? [signal] : []),
    ]);
    for (let attempt = 0; attempt < 3; attempt++) {
      combined.throwIfAborted();
      const r = await this.fetcher(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          signal: combined,
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            "X-Title": "Makale",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content },
            ],
            temperature: 0.15,
            max_tokens: maxTokens,
          }),
        },
      );
      if ([429, 502, 503, 504].includes(r.status) && attempt < 2) {
        await r.body?.cancel();
        const delay = Math.min(
          Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt,
          10000,
        );
        await new Promise((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(combined.reason);
          };
          const timer = setTimeout(() => {
            combined.removeEventListener("abort", stop);
            resolve();
          }, delay);
          combined.addEventListener("abort", stop, { once: true });
        });
        continue;
      }
      if (!r.ok) throw new Error(`OPENROUTER_${r.status}`);
      const data = await r.json();
      if (data.error)
        throw new Error(`OPENROUTER_${data.error.code || "ERROR"}`);
      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length")
        throw new Error("OUTPUT_TRUNCATED");
      if (
        typeof choice?.message?.content !== "string" ||
        !choice.message.content.trim()
      )
        throw new Error("EMPTY_MODEL_RESPONSE");
      return choice.message.content;
    }
  }
}
export async function translate({
  client,
  article,
  model,
  terms = DEFAULT_TERMS,
  ids,
  signal,
  onBatch = () => {},
  onProgress = () => {},
}) {
  const units = article.units.filter(
    (u) =>
      !article.locked.includes(u.id) &&
      (!ids || ids.includes(u.id)) &&
      !article.translations[u.id],
  );
  const groups = batches(units, 6500);
  for (let i = 0; i < groups.length; i++) {
    signal?.throwIfAborted();
    onProgress({ stage: "translation", done: i, total: groups.length });
    const masked = groups[i].map((u) => ({
      id: u.id,
      ...protect(u.text, terms),
    }));
    const payload = JSON.stringify({
      units: masked.map((u) => ({ id: u.id, text: u.masked })),
    });
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await client.complete(
          model,
          TRANSLATION_PROMPT +
            (attempt
              ? "\nYour prior response failed validation. Follow the JSON and token contract exactly."
              : ""),
          payload,
          signal,
        );
        result = validateTranslations(raw, masked);
        break;
      } catch (error) {
        if (
          ![
            "PROTECTION_MISMATCH",
            "INVALID_TRANSLATION_JSON",
            "TRANSLATION_UNIT_MISMATCH",
          ].includes(error.message) ||
          attempt === 1
        )
          throw error;
      }
    }
    Object.assign(article.translations, result);
    article.translationModel = model;
    await onBatch(article);
    onProgress({ stage: "translation", done: i + 1, total: groups.length });
  }
  return article;
}
export async function makeReport({
  client,
  article,
  model,
  language,
  signal,
  onProgress = () => {},
}) {
  const source = (article.evidence || article.units).flatMap((u) =>
    (u.text.match(/[\s\S]{1,3500}/g) || []).map((text) => ({ id: u.id, text })),
  );
  const chunks = batches(source, 20000);
  const evidence = [];
  if (chunks.length > 1)
    for (let i = 0; i < chunks.length; i++) {
      onProgress({ stage: "evidence", done: i, total: chunks.length });
      evidence.push(
        `[chunk ${i + 1}]\n` +
          (await client.complete(
            model,
            EVIDENCE_PROMPT,
            JSON.stringify({
              language,
              chunk: i + 1,
              total: chunks.length,
              units: chunks[i],
            }),
            signal,
            6000,
          )),
      );
    }
  onProgress({ stage: "report", done: 0, total: 1 });
  // Hierarchical reduction keeps arbitrarily long articles within a bounded context.
  let material =
    chunks.length > 1
      ? evidence.join("\n\n")
      : source.map((u) => `[${u.id}] ${u.text}`).join("\n");
  while (material.length > 60000) {
    const groups = batches(
      material.split(/\n\n/).map((text, i) => ({ id: `e${i}`, text })),
      26000,
    );
    const reduced = [];
    for (let i = 0; i < groups.length; i++) {
      onProgress({ stage: "evidence", done: i, total: groups.length });
      reduced.push(
        await client.complete(
          model,
          EVIDENCE_PROMPT +
            "\nCondense this evidence to at most 2000 words; preserve all evidence ids and important facts.",
          JSON.stringify({ language, evidence: groups[i] }),
          signal,
          3500,
        ),
      );
    }
    const next = reduced.join("\n\n");
    if (next.length >= material.length)
      throw new Error("REPORT_CONTEXT_TOO_LARGE");
    material = next;
  }
  const draft = await client.complete(
    model,
    REPORT_PROMPT,
    JSON.stringify({
      language,
      title: article.title,
      source: article.source,
      extractionWarning: article.warning,
      evidence: material,
    }),
    signal,
    12000,
  );
  onProgress({ stage: "report", done: 1, total: 2 });
  return client.complete(
    model,
    REPORT_REVIEW_PROMPT,
    JSON.stringify({
      language,
      title: article.title,
      evidence: material,
      draft,
    }),
    signal,
    12000,
  );
}
export async function makeBlog({ client, article, model, language, signal }) {
  if (article.notes.length + article.report.length > 65000)
    throw new Error("NOTES_TOO_LARGE");
  return client.complete(
    model,
    BLOG_PROMPT,
    JSON.stringify({
      language,
      title: article.title,
      source: article.source,
      notes: article.notes,
      report: article.report || article.units.slice(0, 20),
    }),
    signal,
    8000,
  );
}
