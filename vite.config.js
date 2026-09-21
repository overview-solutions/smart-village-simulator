import { defineConfig } from "vite";

/** Serve public/villages/index.html for /villages and /villages/ (MPA has no SPA fallback). */
function villagesIndex() {
  return {
    name: "villages-index",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url || "";
        const path = raw.split("?")[0];
        if (path === "/villages" || path === "/villages/") {
          const qs = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
          req.url = "/villages/index.html" + qs;
        }
        next();
      });
    },
  };
}

/** @type {import('vite').UserConfig} */
export default defineConfig({
  root: "village-simulator",
  base: "./",
  appType: "mpa",
  plugins: [villagesIndex()],
  server: {
    port: 5176,
    strictPort: true,
    open: "/",
  },
  preview: { port: 5176, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true },
});
