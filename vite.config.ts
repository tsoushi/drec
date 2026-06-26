import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  ssr: {
    // better-sqlite3 is a native module; keep it external in the SSR bundle.
    external: ["better-sqlite3"],
  },
});
