import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  // Tell Vite about both HTML entry points
  // index.html     → the main app  (http://localhost:5173/)
  // mic-test.html  → mic test page (http://localhost:5173/mic-test.html)
  build: {
    rollupOptions: {
      input: {
        main:    'index.html',
        micTest: 'mic-test.html',
        pdfTest: 'pdf-test.html',
        cleaner: 'cleaner.html',
        labeler: 'labeler.html',
      },
    },
  },
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sheeter',
        short_name: 'Sheeter',
        description: 'Sheet music practice app',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        // TODO: add icons (192x192 and 512x512 PNG) to /public/icons/
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    // 'npm run host' exposes the dev server to your local network
    // so your phone can connect via http://YOUR_PC_IP:5173
    // Find your PC's IP: run 'ipconfig' (Windows) and look for IPv4 Address
    host: true,
    port: 5173,
  },
})
