import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import type { Article } from "./types";
const md = new MarkdownIt({ html: false, linkify: false }).use(texmath, {
  engine: katex,
  delimiters: ["dollars", "brackets"],
  katexOptions: { throwOnError: false, trust: false, output: "mathml" },
});
export const renderMarkdown = (text: string) =>
  DOMPurify.sanitize(md.render(text), {
    ADD_TAGS: ["semantics", "annotation", "use"],
    ADD_ATTR: ["encoding"],
  });
export function renderArticle(article: Article, translated = false) {
  const doc = new DOMParser().parseFromString(
    DOMPurify.sanitize(article.html, {
      ADD_TAGS: ["semantics", "annotation", "use"],
      ADD_ATTR: ["encoding"],
    }),
    "text/html",
  );
  doc.querySelectorAll("[data-unit]").forEach((el) => {
    const id = el.getAttribute("data-unit")!;
    if (article.locked.includes(id)) {
      el.classList.add("locked-unit");
      return;
    }
    if (translated && article.translations[id]) {
      el.textContent = article.translations[id];
      el.classList.add("translated-unit");
    } else if (translated) el.classList.add("pending-unit");
  });
  return doc.body.innerHTML;
}
