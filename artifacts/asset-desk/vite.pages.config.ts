import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// GitHub Pages base path — uses the repository name automatically.
// If VITE_REPO_NAME is set (via GitHub Actions env), the app is hosted at
// https://<username>.github.io/<repo-name>/
// Otherwise falls back to "/" (useful for custom domains).
const repoName = process.env.VITE_REPO_NAME;
const base = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
});
