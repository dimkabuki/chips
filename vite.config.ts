import { defineConfig } from "vite";

const normalizeBase = (value: string | undefined): string => {
  if (value === undefined || value.trim() === "") return "/";
  const trimmed = value.trim();
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
};

const repositoryName = process.env.GITHUB_REPOSITORY_NAME ?? process.env.GITHUB_REPOSITORY?.split("/").at(1);

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH ?? repositoryName),
});
