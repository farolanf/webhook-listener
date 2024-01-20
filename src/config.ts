import fs from 'node:fs'
import yaml from 'yaml'

export function loadConfig(file: string): WebhookListenerConfig {
  const config = yaml.parse(fs.readFileSync(file, 'utf8')) as WebhookListenerConfig
  config.projects = config.projects.map(project => {
    project.events ??= ['push']
    return project
  })
  return config
}