import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://vfactor.io",
  server: {
    port: 4321,
    host: true,
  },
  preview: {
    port: 4321,
    host: true,
  },
})
