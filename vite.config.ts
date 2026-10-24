import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths, so the build works from a domain root and from a
  // GitHub Pages project subpath without a rebuild.
  base: "./",
  plugins: [react(), tailwindcss()],
});
