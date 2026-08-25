import { defineConfig } from "vite";

export default defineConfig({
  // relative base so the built bundle works at any mount point
  // (local dev/preview at /, GitHub Pages project site at /jumpshot/)
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
});
