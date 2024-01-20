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

const options = program.opts()

if (!fs.existsSync(options.config)) {
  console.log('Missing config file:', options.config)
  exit(1)
}

let config = loadConfig(options.config)

const app = new Hono()

app.post('/', async c => {
  const json = await c.req.json()

  if (config.reload_config) {
    config = loadConfig(options.config)
  }

  void run(json, config)

  return c.body(null, 200)
})

serve({
  fetch: app.fetch,
  port: options.port,
}, info => {
  console.log(`Listening on ${info.address}:${info.port}`)
})
