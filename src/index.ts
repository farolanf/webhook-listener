import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { run } from './runner'

const app = new Hono()

app.post('/', async c => {
  const json = await c.req.json()

  const config = loadConfig(process.env.CONFIG || './webhook-listener.yml')

  run(json, config)

  return c.body(null, 200)
})

const PORT = parseInt(process.env.PORT || '8385')

serve({
  fetch: app.fetch,
  port: PORT
})
