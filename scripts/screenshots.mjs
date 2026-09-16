// Uses the opt-in live-smoke output; never reads or captures an API key.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron, expect } from "@playwright/test";
const live = JSON.parse(await fs.readFile(".local/live-smoke.json", "utf8"));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "makale-screenshots-"));
await fs.writeFile(
  path.join(dir, "workspace.json"),
  JSON.stringify({
    articles: [live.article],
    settings: { language: "tr", theme: "light", model: live.model, terms: [] },
  }),
);
const app = await _electron.launch({
  args: ["."],
  env: {
    ...process.env,
    MAKALE_DATA_DIR: dir,
    OPENROUTER_API_KEY: "",
    MAKALE_DEV: "0",
  },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForSelector(".reading-panes");
  await page.evaluate(() => document.fonts.ready);
  await expect(async () => {
    await page.screenshot({
      animations: "disabled",
      path: "docs/screenshots/reader.png",
    });
  }).toPass({ timeout: 5000 });
  await page.getByRole("button", { name: "AI raporu", exact: true }).click();
  await page.waitForSelector(".report-prose");
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/report.png",
  });
  await page
    .getByRole("button", { name: "Notlar ve blog", exact: true })
    .click();
  await page.getByRole("button", { name: "Tema", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/writing-dark.png",
  });
} finally {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
