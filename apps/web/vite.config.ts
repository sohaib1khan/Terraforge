import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  // Prefer apps/web/.env, then repo-root .env for API_PORT when developing locally.
  const local = loadEnv(mode, process.cwd(), '')
  const root = loadEnv(mode, path.resolve(process.cwd(), '../..'), '')
  const apiPort = local.API_PORT || root.API_PORT || '8088'
  const apiTarget = `http://localhost:${apiPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(local.VITE_DEV_PORT || root.VITE_DEV_PORT || 5173),
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/healthz': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
