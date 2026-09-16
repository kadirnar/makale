import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchArticle } from "./network.mjs";
const mimeFor = (filename) =>
  ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
  })[path.extname(filename).toLowerCase()];
export async function snapshotImages(
  article,
  baseDirectory,
  fetcher = fetchArticle,
) {
  const doc = new JSDOM(article.html).window.document;
  const images = Array.from(doc.querySelectorAll("img"));
  let size = 0;
  const cache = new Map();
  if (images.length > 150) throw new Error("TOO_MANY_IMAGES");
  for (const image of images) {
    const src = image.getAttribute("src");
    if (!src) continue;
    if (src.startsWith("data:image/")) {
      size += src.length;
      if (size > 40 * 1024 * 1024) throw new Error("IMAGES_TOO_LARGE");
      continue;
    }
    if (cache.has(src)) {
      image.setAttribute("src", cache.get(src));
      continue;
    }
    let bytes, type;
    try {
      if (/^https?:\/\//.test(src)) {
        const result = await fetcher(src);
        bytes = result.bytes;
        type = result.type.split(";")[0];
      } else if (baseDirectory && !/^[a-z]+:/i.test(src)) {
        const base = await fs.realpath(baseDirectory),
          file = await fs.realpath(path.resolve(base, decodeURIComponent(src)));
        if (!file.startsWith(base + path.sep))
          throw new Error("IMAGE_PATH_OUTSIDE_ARTICLE");
        if ((await fs.stat(file)).size > 15 * 1024 * 1024)
          throw new Error("IMAGES_TOO_LARGE");
        bytes = await fs.readFile(file);
        type = mimeFor(file);
      } else throw new Error("UNRESOLVED_IMAGE");
      if (!/^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/.test(type || ""))
        throw new Error("INVALID_IMAGE_TYPE");
    } catch {
      throw new Error("IMAGE_IMPORT_FAILED");
    }
    size += bytes.length;
    if (size > 30 * 1024 * 1024) throw new Error("IMAGES_TOO_LARGE");
    const data = `data:${type};base64,${bytes.toString("base64")}`;
    cache.set(src, data);
    image.setAttribute("src", data);
  }
  article.html = doc.body.innerHTML;
  return article;
}
