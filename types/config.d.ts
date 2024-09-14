type WebhookListenerConfig = {
  reload_config: boolean
  projects: Project[]
}

type WebhookEvent = string | Record<string, string>

type Project = {
  repo: string
  secret: string
  events: WebhookEvent[]
  dir?: string
  command: string
}