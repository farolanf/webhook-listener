type WebhookListenerConfig = {
  projects: Project[]
}

type Project = {
  repo: string
  secret: string
  events?: string[]
  dir?: string
  command: string
}