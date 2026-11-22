import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // changeOrigin false keeps the browser's Host header, so the backend's same-origin check (R28.6) sees
    // Origin and Host from the same origin. The string shorthand would rewrite Host and every command would get 403.
    proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: false } },
  },
});
