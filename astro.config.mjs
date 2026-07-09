import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  output: "server",
  security: {
    checkOrigin: true
  },
  vite: {
    server: {
      allowedHosts: ["localhost", "127.0.0.1"]
    }
  }
});
