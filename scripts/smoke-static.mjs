import { access, readFile } from "node:fs/promises";

const requiredFiles = ["dist/index.html", "dist/manifest.webmanifest", "dist/sw.js", "dist/icon.svg", "dist/.nojekyll", "dist/assets/index.js", "dist/assets/index.css", "dist/assets/index-Cp5NZACF.js", "dist/assets/index-DUYPVtKm.css"];
await Promise.all(requiredFiles.map((file) => access(file)));
const index = await readFile("dist/index.html", "utf8");
const manifest = await readFile("dist/manifest.webmanifest", "utf8");
const sw = await readFile("dist/sw.js", "utf8");
if (!index.includes("Content-Security-Policy") || !index.includes("manifest.webmanifest") || !index.includes("/assets/")) throw new Error("Built app shell is missing CSP, manifest, or asset references.");
if (index.includes("/src/main.ts")) throw new Error("Built app shell still points at the development TypeScript entrypoint.");
if (!manifest.includes("icon.svg")) throw new Error("Manifest is missing an installability icon.");
if (!sw.includes("self.registration.scope")) throw new Error("Service worker is not scope-aware.");
if (!sw.includes('event.request.mode === "navigate"')) throw new Error("Service worker must fetch navigations from network before cached fallback.");
if (!index.includes("/assets/index.js") || !index.includes("/assets/index.css")) throw new Error("Built app shell must use stable entry asset names.");
console.log("Static smoke passed: built app shell, CSP, manifest icon, no-Jekyll marker, and offline assets exist.");
