import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./harness", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  server: {
    port: 4174,
    host: "127.0.0.1",
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  css: { postcss: fileURLToPath(new URL("../..", import.meta.url)) },
});
