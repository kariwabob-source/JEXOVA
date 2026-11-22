import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const laravelProxyOptions = {
  target: "http://127.0.0.1:8000",
  changeOrigin: false
};

const laravelRoutes = [
  "^/$",
  "/build",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/email",
  "/logout",
  "/accounts",
  "/trades",
  "/strategies",
  "/trade-options",
  "/trade-summary",
  "/mt5"
];

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    proxy: Object.fromEntries(
      laravelRoutes.map((route) => [route, { ...laravelProxyOptions }])
    )
  },
  build: {
    manifest: "manifest.json",
    outDir: fileURLToPath(new URL("../backend/public/build", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./src/main.jsx", import.meta.url))
    }
  }
});
