import child_process from "node:child_process"
import { validateSignature } from "./secret"

const isEventAllowed = (event: string, allowedEvents: WebhookEvent[], payload: any) => {
  return allowedEvents.some(allowedEvent => {
    if (typeof allowedEvent === 'string') {
      return event === allowedEvent
    } else if (typeof allowedEvent === 'object') {
      for (const key in allowedEvent) {
        if (key === 'event') {
          if (event !== allowedEvent[key]) return false
        } else if (payload[event][key] !== (allowedEvent as any)[key]) return false
      }
      return true
    } else {
      throw new Error(`Invalid event type: ${typeof allowedEvent} ${JSON.stringify(allowedEvent)}`)
    }
  })
}

export async function run(event: string, payload: any, config: WebhookListenerConfig, signature: string) {
  const promises = config.projects.map(project => {
    return new Promise<void>((resolve, reject) => {
      if (
        project.repo !== payload.repository.full_name ||
        !isEventAllowed(event, project.events, payload) ||
        !validateSignature(signature, project.secret, payload)
      ) return resolve()

      try {
        console.log(`${project.repo} (${event}) ${project.dir} ${project.command}`)
        child_process.execSync(project.command, {
          cwd: project.dir,
        })
        resolve()
      } catch(e) {
        reject(e)
      }
    })
  })

  return Promise.all(promises)
}