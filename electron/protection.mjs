import { randomBytes } from "node:crypto";
export const DEFAULT_TERMS = [
  "Transformer",
  "Attention",
  "Learning rate",
  "Batch size",
  "Multi-head attention",
  "attention",
  "self-attention",
  "cross-attention",
  "multi-head attention",
  "embedding",
  "embeddings",
  "token",
  "tokens",
  "tokenizer",
  "fine-tuning",
  "pretraining",
  "backpropagation",
  "gradient descent",
  "learning rate",
  "batch size",
  "dropout",
  "softmax",
  "LayerNorm",
  "RMSNorm",
  "LoRA",
  "QLoRA",
  "RLHF",
  "DPO",
  "PPO",
  "GRPO",
  "GPU",
  "TPU",
  "CUDA",
  "PyTorch",
  "TensorFlow",
  "LLM",
  "NLP",
  "BLEU",
  "ROUGE",
  "ImageNet",
  "cross-entropy",
  "loss function",
  "diffusion",
  "reinforcement learning",
  "chain-of-thought",
  "Mixture of Experts",
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function protect(text, terms = DEFAULT_TERMS) {
  const nonce = randomBytes(6).toString("hex");
  const parts = [
    /⟦KEEP_[^⟧]*⟧/.source,
    /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/
      .source,
    /`[^`]+`|https?:\/\/[^\s<>]+|\[[\d,;\s–-]+\]/.source,
    /\b[A-Za-z][\w^{}().]*\s*[=≈≠≤≥∝∈]\s*[^,;\n]+/.source,
    /[α-ωΑ-Ω∑∏∫√∞∂∇][\w^{}()α-ωΑ-Ω+*/= .-]*/.source,
    /\b\d+(?:[.,]\d+)*(?:\s?[×x]\s?10\^?-?\d+)?(?:%|\b)/.source,
    /\b(?:[A-Z]{2,}[\w.-]*|[A-Z][a-z]+(?:[A-Z][\w]*)+)\b/.source,
    ...terms
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((t) => `(?<![\\p{L}\\p{N}_])${escape(t)}(?![\\p{L}\\p{N}_])`),
  ];
  const values = [];
  const masked = text.replace(new RegExp(parts.join("|"), "gu"), (value) => {
    const token = `⟦KEEP_${nonce}_${values.length}⟧`;
    values.push({ token, value });
    return token;
  });
  return { masked, values };
}
export function restore(text, values) {
  const actual = text.match(/⟦KEEP_[^⟧]*⟧/g) || [];
  const expected = values.map((x) => x.token);
  if (JSON.stringify(actual.toSorted()) !== JSON.stringify(expected.toSorted()))
    throw new Error("PROTECTION_MISMATCH");
  let result = text;
  for (const { token, value } of values)
    result = result.replace(token, () => value);
  return result;
}
export function validateTranslations(raw, protectedUnits) {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("INVALID_TRANSLATION_JSON");
  }
  if (
    !Array.isArray(parsed.translations) ||
    parsed.translations.length !== protectedUnits.length
  )
    throw new Error("TRANSLATION_UNIT_MISMATCH");
  const out = {};
  for (const unit of protectedUnits) {
    const matches = parsed.translations.filter((x) => x.id === unit.id);
    if (
      matches.length !== 1 ||
      typeof matches[0].text !== "string" ||
      !matches[0].text.trim()
    )
      throw new Error("TRANSLATION_UNIT_MISMATCH");
    out[unit.id] = restore(matches[0].text, unit.values);
  }
  return out;
}
export function batches(units, maxChars = 10000) {
  const groups = [];
  let group = [],
    chars = 0;
  for (const unit of units) {
    if (group.length && chars + unit.text.length > maxChars) {
      groups.push(group);
      group = [];
      chars = 0;
    }
    group.push(unit);
    chars += unit.text.length;
  }
  if (group.length) groups.push(group);
  return groups;
}
