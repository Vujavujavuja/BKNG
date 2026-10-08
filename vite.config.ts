import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  // Relative asset URLs, so the app also works when mounted under a path such as /book.
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
