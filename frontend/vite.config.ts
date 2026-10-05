import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  server: { fs: { allow: [".."] } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: null,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff,woff2,webmanifest}"],
        // O plugin já acrescenta o manifest e os ícones declarados nele.
        globIgnores: [
          "**/manifest.webmanifest",
          "**/icons/icon-192.png",
          "**/icons/icon-512.png",
          "**/icons/maskable-512.png",
        ],
      },
      manifest: {
        name: "BunkerMode",
        short_name: "BunkerMode",
        description: "Seu espaço pessoal de execução.",
        lang: "pt-BR",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#1e1e1e",
        background_color: "#181818",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
})
