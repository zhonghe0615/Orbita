import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时将 API 请求转发到 wrangler dev
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
      '/chat': 'http://localhost:8787',
      '/user': 'http://localhost:8787',
    },
  },
})
