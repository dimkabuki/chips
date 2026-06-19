import { access, readFile } from "node:fs/promises";

const requiredFiles = ["dist/index.html", "dist/manifest.webmanifest", "dist/sw.js", "dist/icon.svg"];
await Promise.all(requiredFiles.map((file) => access(file)));
const index = await readFile("dist/index.html", "utf8");
const manifest = await readFile("dist/manifest.webmanifest", "utf8");
const sw = await readFile("dist/sw.js", "utf8");
if (!index.includes("Content-Security-Policy") || !index.includes("manifest.webmanifest") || !index.includes("/assets/")) throw new Error("Built app shell is missing CSP, manifest, or asset references.");
if (!manifest.includes("icon.svg")) throw new Error("Manifest is missing an installability icon.");
if (!sw.includes("self.registration.scope")) throw new Error("Service worker is not scope-aware.");
console.log("Static smoke passed: built app shell, CSP, manifest icon, and offline assets exist.");
