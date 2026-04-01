import child_process from "node:child_process"
import { validateSignature } from "./secret"

let currentProcess: child_process.ChildProcess | null = null

export function cancelCurrentBuild() {
  if (currentProcess) {
    currentProcess.kill('SIGTERM')
    currentProcess = null
  }
}

const matchHeadBranch = (payloadBranch: string | undefined, configBranch: string): boolean => {
  if (!payloadBranch) return false
  if (configBranch.endsWith('*')) {
    const prefix = configBranch.slice(0, -1)
    return payloadBranch.startsWith(prefix)
  }
  return payloadBranch === configBranch
}

const isEventAllowed = (event: string, allowedEvents: WebhookEvent[], payload: any) => {
  return allowedEvents.some(allowedEvent => {
    if (typeof allowedEvent === 'string') {
      return event === allowedEvent
    } else if (typeof allowedEvent === 'object') {
      for (const key in allowedEvent) {
        if (key === 'event') {
          if (event !== allowedEvent[key]) return false
        } else if (key === 'head_branch') {
          if (!matchHeadBranch(payload[event][key], (allowedEvent as any)[key])) return false
        } else if (payload[event][key] !== (allowedEvent as any)[key]) return false
      }
      return true
    } else {
      throw new Error(`Invalid event type: ${typeof allowedEvent} ${JSON.stringify(allowedEvent)}`)
    }
  })
}

export async function run(event: string, payload: any, config: WebhookListenerConfig, signature: string) {
  cancelCurrentBuild()

  for (const project of config.projects) {
    if (
      project.repo !== payload.repository.full_name ||
      !isEventAllowed(event, project.events, payload) ||
      !validateSignature(signature, project.secret, payload)
    ) continue

    console.log(`[${new Date().toISOString()}] ${project.repo} (${event}) ${project.dir} ${project.command}`)

    await new Promise<void>((resolve, reject) => {
      currentProcess = child_process.exec(project.command, { cwd: project.dir })
      currentProcess.on('exit', (code) => {
        currentProcess = null
        code === 0 ? resolve() : reject(new Error(`Command failed with code ${code}`))
      })
      currentProcess.on('error', (err) => {
        currentProcess = null
        reject(err)
      })
    })
  }
}