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
    expect(index).toContain("Content-Security-Policy");
    expect(JSON.parse(manifest) as unknown).toMatchObject({ name: "Chips", start_url: ".", scope: ".", display: "standalone", icons: [{ src: "icon.svg", purpose: "any maskable" }] });
    expect(serviceWorker).toContain("chips-static-v3");
    expect(serviceWorker).toContain("self.registration.scope");
    expect(serviceWorker).toContain('event.request.mode === "navigate"');
    expect(serviceWorker).toContain("fetch(event.request)");
    expect(serviceWorker).not.toContain("cache.put(event.request");
    expect(main).toContain("navigator.serviceWorker.register(`${base}sw.js`, { scope: base })");
  });
});
