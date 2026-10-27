import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.DRIVEPULSE_API_ORIGIN || 'http://127.0.0.1:5000' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:5000' } },
})
