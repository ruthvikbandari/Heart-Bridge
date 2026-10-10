import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const apiTarget = process.env.HEARTBRIDGE_API_TARGET ?? "http://127.0.0.1:8000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, ws: true, changeOrigin: true },
      "/uploads": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
  },
})
