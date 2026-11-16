import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const certPath = process.env.SSL_CERT_PATH
  ? path.resolve(__dirname, process.env.SSL_CERT_PATH)
  : path.resolve(__dirname, 'certs/cert.pem')
const keyPath = process.env.SSL_KEY_PATH
  ? path.resolve(__dirname, process.env.SSL_KEY_PATH)
  : path.resolve(__dirname, 'certs/key.pem')
const hasCerts =
  process.env.SSL_ENABLED !== 'false' &&
  fs.existsSync(certPath) &&
  fs.existsSync(keyPath)

const httpsConfig = hasCerts
  ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true,
    https: httpsConfig,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
    https: httpsConfig,
  },
})