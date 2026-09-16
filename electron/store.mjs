import fs from "node:fs/promises";
import path from "node:path";
export class Store {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  async load() {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.directory, "workspace.json"), "utf8"),
      );
    } catch (e) {
      if (e.code === "ENOENT")
        return {
          articles: [],
          settings: { language: "tr", theme: "system", model: "", terms: [] },
        };
      throw new Error("WORKSPACE_READ_FAILED");
    }
  }
  save(state) {
    const data = JSON.stringify(state);
    const file = path.join(this.directory, "workspace.json");
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(file + ".tmp", data, { mode: 0o600 });
        await fs.rename(file + ".tmp", file);
      });
    return this.queue;
  }
  async savePdf(id, bytes) {
    await fs.writeFile(path.join(this.directory, `${id}.pdf`), bytes, {
      mode: 0o600,
    });
  }
  async pdf(id) {
    return fs.readFile(path.join(this.directory, `${id}.pdf`));
  }
}
