import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createSession } from './api/_session.ts'

// Serves /api/session during `npm run dev` the same way the Vercel function does in production.
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/session', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          let body: unknown = null
          try { body = JSON.parse(raw) } catch { /* invalid JSON → 400 below */ }
          const { status, json } = await createSession(body, env)
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(json))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), devApi(loadEnv(mode, process.cwd(), 'COMETCHAT_'))],
}))
