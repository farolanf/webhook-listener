type WebhookListenerConfig = {
  secret: string
  reload_config: boolean
  projects: Project[]
}

type Project = {
  repo: string
  events: string[]
  dir?: string
  command: string
}