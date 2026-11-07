import { defineConfig } from "vite";

const page = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  server: { port: 5174, strictPort: true },
  build: {
    rollupOptions: {
      input: { stage: page("./index.html"), phone: page("./phone.html") },
    },
  },
});
