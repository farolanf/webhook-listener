import yaml from 'yaml'

export function loadConfig(file: string): WebhookListenerConfig {
  return yaml.parse(file)
}