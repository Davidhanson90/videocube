import { defineConfig } from "vite";

export default defineConfig({
  base: "/videocube/",
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
