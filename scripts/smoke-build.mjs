import { access, readFile } from "node:fs/promises";

const requiredFiles = ["dist/index.html", "dist/manifest.webmanifest", "dist/sw.js"];
await Promise.all(requiredFiles.map((file) => access(file)));
const index = await readFile("dist/index.html", "utf8");
if (!index.includes("manifest.webmanifest") || !index.includes("/assets/")) {
  throw new Error("Built app shell is missing expected manifest or asset references.");
}
console.log("Browser smoke passed: built app shell and offline assets exist.");
