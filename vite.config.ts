import { copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const normalizeBase = (value: string | undefined): string => {
  if (value === undefined || value.trim() === "") return "/";
  const trimmed = value.trim();
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
};

const repositoryName = process.env.GITHUB_REPOSITORY_NAME ?? process.env.GITHUB_REPOSITORY?.split("/").at(1);

const staleEntryAliases = (): Plugin => ({
  name: "stale-entry-aliases",
  apply: "build",
  closeBundle: async () => {
    const assetsDir = join(process.cwd(), "dist", "assets");
    const files = await readdir(assetsDir);
    const entryScript = files.find((file) => file === "index.js");
    const entryStyle = files.find((file) => file === "index.css");
    if (entryScript !== undefined) await copyFile(join(assetsDir, entryScript), join(assetsDir, "index-Cp5NZACF.js"));
    if (entryStyle !== undefined) await copyFile(join(assetsDir, entryStyle), join(assetsDir, "index-DUYPVtKm.css"));
  },
});

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH ?? repositoryName),
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  plugins: [staleEntryAliases()],
});
