import fs from 'node:fs'
import { program } from 'commander'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { loadConfig } from './config'
import { run } from './runner'
import { exit } from 'node:process'

program
  .option('-c, --config <path>', 'path to config file', './webhook-listener.yml')
  .option('-p, --port <number>', 'port to listen on', '8385')

program.parse()

// Safety net: a failed deploy must never take the listener down. Without these,
// an unhandled rejection/exception crashes the process (Node >= 15 default),
// leaving the stack in whatever half-deployed state the command died in.
process.on('unhandledRejection', reason => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection:`, reason)
})
process.on('uncaughtException', err => {
  console.error(`[${new Date().toISOString()}] Uncaught exception:`, err)
})

const options = program.opts()

if (!fs.existsSync(options.config)) {
  console.log(`[${new Date().toISOString()}] Missing config file: ${options.config}`)
  exit(1)
}

let config = loadConfig(options.config)

const app = new Hono()

app.post('/', async c => {
  const event = c.req.header('x-github-event')
  if (!event) return c.body(null, 400)

  if (config.reload_config) {
    config = loadConfig(options.config)
  }

  let body
  try {
    body = await c.req.json()
  } catch (err) {
    console.log(`[${new Date().toISOString()}] ${err}`)
    return c.body(null, 400)
  }

  const signature = c.req.header('x-hub-signature-256') || ''

  run(event, body, config, signature).catch(err => {
    console.error(`[${new Date().toISOString()}] Deploy failed:`, err)
  })

  return c.body(null, 200)
})

serve({
  fetch: app.fetch,
  port: options.port,
}, info => {
  console.log(`[${new Date().toISOString()}] Listening on ${info.address}:${info.port}`)
})
