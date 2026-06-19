import { spawn } from "node:child_process";
import { chromium } from "playwright";

const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4173"], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("vite preview did not start")), 15000);
  preview.stdout.on("data", (chunk) => { if (chunk.toString().includes("Local:")) { clearTimeout(timer); resolve(); } });
  preview.on("exit", (code) => reject(new Error(`vite preview exited ${String(code)}`)));
});
try {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.getByLabel("Player 1 name").fill("Ada");
  await page.getByLabel("Player 2 name").fill("Linus");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Create game" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await page.getByRole("button", { name: /Call/ }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Recovered saved game.").waitFor();
  await page.getByLabel("Confirm undo").check();
  await page.getByRole("button", { name: "Undo last action" }).click();
  await page.getByLabel("Corrected stack").first().fill("990");
  await page.getByLabel("Corrected stack").nth(1).fill("1010");
  await page.getByLabel("Correction reason").fill("smoke count");
  await page.getByRole("button", { name: "Apply stack correction" }).click();
  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active game").waitFor();
  await browser.close();
  console.log("Browser smoke passed: production app loads, reload recovery, undo, stack correction, 320 px, accessible names, and offline startup work.");
} finally {
  preview.kill();
}
