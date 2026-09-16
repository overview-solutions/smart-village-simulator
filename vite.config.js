import { defineConfig } from "vite";

/** @type {import('vite').UserConfig} */
export default defineConfig({
  root: "village-simulator",
  base: "./",
  server: { port: 5176, strictPort: true, open: "/" },
  preview: { port: 5176, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true },
});
