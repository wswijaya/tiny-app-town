import { Hono } from 'hono'
import { handle } from 'hono/vercel'

export const config = { runtime: 'nodejs20.x' }

const app = new Hono().basePath('/api')

app.post('/messages', async (c) => {
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

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
})

export default handle(app)
