import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let app: ElectronApplication, page: Page, directory: string;
const fixture = path.resolve("tests/fixtures/article.md");
async function launch() {
  app = await electron.launch({
    args: [".", ...(process.env.CI ? ["--no-sandbox"] : [])],
    env: {
      ...process.env,
      MAKALE_DATA_DIR: directory,
      OPENROUTER_API_KEY: "",
      MAKALE_DEV: "0",
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForSelector(".welcome, .article-heading");
}
async function fakeProvider() {
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input: any, options: any) => {
      if (String(input).endsWith("/models"))
        return Response.json({
          data: [
            {
              id: "test/research",
              name: "Research model",
              context_length: 128000,
              architecture: { output_modalities: ["text"] },
              pricing: { prompt: "0.0000001", completion: "0.0000002" },
            },
          ],
        });
      if (String(input).endsWith("/chat/completions")) {
        const request = JSON.parse(options.body),
          system = request.messages[0].content,
          payload = JSON.parse(request.messages[1].content);
        if (system.includes("scientific translator"))
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    translations: payload.units.map((u: any) => ({
                      id: u.id,
                      text: "Türkçe çeviri: " + u.text,
                    })),
                  }),
                },
              },
            ],
          });
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: system.includes("research reviewer")
                  ? "# Ayrıntılı rapor\n\n## Eğitim ve donanım\n\nGPU modeli belirtilmemiştir. [u1]\n\n## Güçlü yönler\n\nSayısal sonuçlar raporlanmıştır. [u1]"
                  : "# Blog taslağı\n\nBu makale attention mekanizmasını açıklıyor.",
              },
            },
          ],
        });
      }
      return original(input, options);
    };
  });
}
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "makale-e2e-"));
  await launch();
});
test.afterEach(async () => {
  await app?.close();
  await fs.rm(directory, { recursive: true, force: true });
});
test("complete desktop workflow: import, model, translation, report, notes, blog, export and restart", async () => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Derinlemesine okumaya yer açın." }),
  ).toBeVisible();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, fixture);
  await page.getByRole("button", { name: "Dosya yükle", exact: false }).click();
  await expect(page.locator(".title-row h1")).toHaveText(
    "Reliable model evaluation",
  );
  await expect(
    page.locator(".reading-pane").first().locator("math"),
  ).toHaveCount(2);
  const mathBefore = await page
    .locator(".reading-pane")
    .first()
    .locator("math")
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML));
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page
    .getByRole("textbox", { name: "OpenRouter API anahtarı", exact: true })
    .fill("sk-or-test-dummy");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(
    page.getByText("API anahtarı hazır", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kapat", exact: true }).last().click();
  await fakeProvider();
  await page.locator(".model-button").click();
  await page.getByRole("button", { name: /Research model/ }).click();
  await page
    .getByRole("button", { name: "Makaleyi çevir", exact: true })
    .click();
  await expect(page.locator(".status-label")).toHaveText("Çeviri tamamlandı");
  const mathAfter = await page
    .locator(".translated-pane math")
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML));
  expect(mathAfter).toEqual(mathBefore);
  await expect(page.locator(".translated-pane pre")).toHaveText(
    "loss = -(target * prediction.log()).sum()",
  );
  await page.getByRole("button", { name: "AI raporu", exact: true }).click();
  await page
    .getByRole("button", { name: "Rapor oluştur", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ayrıntılı rapor" }),
  ).toBeVisible();
  await page.locator(".evidence-link").first().click();
  await expect(page.locator(".reading-panes")).toBeVisible();
  await page
    .getByRole("button", { name: "Notlar ve blog", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Okuma notları", exact: true })
    .fill("## Kendi notlarım\n\nVeri kümesinin lisansı belirsiz.");
  await expect(
    page.getByText("Yerel olarak kaydedildi", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "AI ile taslak oluştur", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Blog taslağı", exact: true }),
  ).toHaveValue(/attention/);
  const exportPath = path.join(directory, "blog.md");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportPath);
  await page
    .getByRole("button", { name: "Blogu dışa aktar", exact: true })
    .click();
  await expect
    .poll(() => fs.readFile(exportPath, "utf8"))
    .toContain("attention");
  await page.getByRole("button", { name: "Tema", exact: true }).click();
  await page.getByRole("button", { name: "TR", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Notes & blog", exact: true }),
  ).toBeVisible();
  await app.close();
  await launch();
  await page.getByRole("button", { name: "Notes & blog", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Reading notes", exact: true }),
  ).toHaveValue("## Kendi notlarım\n\nVeri kümesinin lisansı belirsiz.");
  expect(pageErrors).toEqual([]);
});
test("PDF retains original figure and requires extraction review", async () => {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path.resolve("tests/fixtures/research.pdf"));
  await page.getByRole("button", { name: "Dosya yükle", exact: false }).click();
  await expect(page.locator(".pdf-page canvas")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".pdf-page canvas")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBeGreaterThan(500);
  await expect(
    page.getByRole("button", { name: "Makaleyi çevir", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Çıkarılan metin", exact: true })
    .click();
  await expect(page.locator(".reading-pane").first()).toContainText("92.5");
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "Makaleyi çevir", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Orijinal PDF", exact: true }).click();
  await expect(page.locator('canvas[data-rendered="true"]')).toBeVisible();
});
test("invalid key and model failures remain actionable without losing imported source", async () => {
  await page.locator(".add-button").click();
  await page
    .getByRole("button", { name: "Makale metni yapıştır", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Makale başlığı", exact: true })
    .fill("My article");
  await page
    .getByRole("textbox", { name: "Markdown veya düz metin", exact: true })
    .fill("# Important research\n\nA GPU study with $x^2$ and Transformer.");
  await page
    .getByRole("button", { name: "Makaleyi içe aktar", exact: true })
    .click();
  await expect(page.locator(".title-row h1")).toHaveText("Important research");
  await page
    .getByRole("button", { name: "Makaleyi çevir", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "OpenRouter API anahtarı", exact: true })
    .fill("sk-or-test-dummy");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("button", { name: "Kapat", exact: true }).last().click();
  await fakeProvider();
  await page.locator(".model-button").click();
  await page.getByRole("button", { name: /Research model/ }).click();
  await app.evaluate(() => {
    globalThis.fetch = async () => new Response("", { status: 401 });
  });
  await page
    .getByRole("button", { name: "Makaleyi çevir", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("API anahtarı geçersiz");
  await expect(
    page.locator(".reading-pane").first().locator("math"),
  ).toHaveCount(1);
});
test("selected passages can be translated and locked independently", async () => {
  await page
    .getByRole("button", { name: "Örnek bir makaleyle keşfedin", exact: false })
    .click();
  await page.evaluate(async () => {
    const data: any = await window.makale.call("init");
    await window.makale.call("key", "sk-or-test-dummy");
    await window.makale.call("settings", {
      ...data.settings,
      model: "test/research",
    });
  });
  await page.reload();
  await fakeProvider();
  const select = async (id: string) => {
    await page
      .locator(".reading-pane")
      .first()
      .locator(`[data-unit="${id}"]`)
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
  };
  await select("u0");
  await page.getByRole("button", { name: "Seçimi çevir", exact: true }).click();
  await expect(page.locator(".status-label")).toContainText("1 /");
  await select("u1");
  await page
    .getByRole("button", { name: "Seçimi olduğu gibi koru", exact: true })
    .click();
  await expect(page.locator(".translated-pane .locked-unit")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Çeviriye devam et", exact: true })
    .click();
  await expect(page.locator(".status-label")).toHaveText("Çeviri tamamlandı");
  await expect(page.locator('.translated-pane [data-unit="u1"]')).toHaveText(
    "A short reading example · Makale studio",
  );
});
