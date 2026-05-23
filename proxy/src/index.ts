import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()

app.post('/api/messages', async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ error: 'ANTHROPIC_API_KEY not set' }, 500)

  const body = await c.req.json()

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  // Forward status, content-type, and body (handles both streaming and non-streaming)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
})

// Serve the HTML frontend from the parent directory
app.use('/*', serveStatic({ root: '../public/' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () =>
  console.log(`Proxy running → http://localhost:${port}`)
)
