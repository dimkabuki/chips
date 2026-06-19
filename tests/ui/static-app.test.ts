import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("static app shell", () => {
  it("declares installable offline assets for GitHub Pages", async () => {
    const [index, manifest, serviceWorker, main] = await Promise.all([
      readFile("index.html", "utf8"),
      readFile("public/manifest.webmanifest", "utf8"),
      readFile("public/sw.js", "utf8"),
      readFile("src/main.ts", "utf8"),
    ]);
    expect(index).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    expect(index).toContain('<meta name="theme-color" content="#0f172a" />');
    expect(JSON.parse(manifest) as unknown).toMatchObject({ name: "Chips", start_url: ".", display: "standalone" });
    expect(serviceWorker).toContain("chips-static-v1");
    expect(serviceWorker).toContain("self.addEventListener(\"fetch\"");
    expect(main).toContain("navigator.serviceWorker.register");
  });
});
