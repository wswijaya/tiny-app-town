import { Hono } from 'hono'
import { handle } from 'hono/vercel'

export const config = { runtime: 'edge' }

const app = new Hono().basePath('/api')

app.post('/messages', async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[proxy] ANTHROPIC_API_KEY is not set')
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 500)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  let upstream: Response
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[proxy] fetch to Anthropic failed:', err)
    return c.json({ error: 'Could not reach Anthropic API' }, 502)
  }

  c.header('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
  c.header('Cache-Control', 'no-cache')
  return c.body(upstream.body, upstream.status as any)
})

export default handle(app)
