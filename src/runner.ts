import child_process from "node:child_process"
import { validateSignature } from "./secret"

let currentProcess: child_process.ChildProcess | null = null
let currentRetryTimer: ReturnType<typeof setTimeout> | null = null
// Bumped whenever a build is superseded/cancelled. An in-flight retry loop
// captures the generation it started under and bails the moment it changes,
// so a newer webhook never runs in parallel with a retry of an older one.
let generation = 0

export function cancelCurrentBuild() {
  generation++
  if (currentRetryTimer) {
    clearTimeout(currentRetryTimer)
    currentRetryTimer = null
  }
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

// A single command attempt. Resolves on exit 0, rejects otherwise. The exit/error
// handlers only clear currentProcess when it still points at this process, so a
// finishing stale build can't null out a newer one's handle.
function execCommand(command: string, dir?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = child_process.exec(command, { cwd: dir })
    currentProcess = proc
    // Forward the command's output to our logs so a failed deploy is diagnosable.
    proc.stdout?.pipe(process.stdout)
    proc.stderr?.pipe(process.stderr)
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      code === 0 ? resolve() : reject(new Error(`Command failed with code ${code}`))
    })
    proc.on('error', (err) => {
      if (currentProcess === proc) currentProcess = null
      reject(err)
    })
  })
}

// Run a project's command, retrying on failure. A transient build/registry/network
// blip shouldn't leave the stack half-deployed until a human re-triggers it. Bails
// silently if a newer build supersedes this one mid-flight (generation changed).
async function runCommandWithRetry(project: Project, startGeneration: number): Promise<void> {
  const retries = project.retries ?? 0
  const retryDelay = project.retry_delay ?? 0

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (generation !== startGeneration) return
    try {
      await execCommand(project.command, project.dir)
      return
    } catch (err) {
      if (generation !== startGeneration) return
      if (attempt === retries) throw err
      console.error(`[${new Date().toISOString()}] ${project.repo} attempt ${attempt + 1}/${retries + 1} failed, retrying in ${retryDelay}ms:`, err)
      await new Promise<void>(resolve => {
        currentRetryTimer = setTimeout(() => {
          currentRetryTimer = null
          resolve()
        }, retryDelay)
      })
    }
  }
}

export async function run(event: string, payload: any, config: WebhookListenerConfig, signature: string) {
  cancelCurrentBuild()
  const startGeneration = generation

  for (const project of config.projects) {
    if (generation !== startGeneration) return
    if (
      project.repo !== payload.repository.full_name ||
      !isEventAllowed(event, project.events, payload) ||
      !validateSignature(signature, project.secret, payload)
    ) continue

    console.log(`[${new Date().toISOString()}] ${project.repo} (${event}) ${project.dir} ${project.command}`)

    await runCommandWithRetry(project, startGeneration)
  }
}

// Re-run every project's command once on startup. An interrupted deploy (supervisor
// restart / reboot with stopasgroup killing the group mid-recreate) leaves the stack
// down with nothing to re-trigger it; deploy commands are idempotent, so replaying
// them on boot converges the stack without waiting for the next webhook. A failure on
// one project is logged and doesn't stop the rest; a webhook arriving mid-reconcile
// supersedes it (generation change) so the two never race.
export async function reconcile(config: WebhookListenerConfig) {
  cancelCurrentBuild()
  const startGeneration = generation

  for (const project of config.projects) {
    if (generation !== startGeneration) return
    console.log(`[${new Date().toISOString()}] reconcile ${project.repo} ${project.dir ?? ''} ${project.command}`)
    try {
      await runCommandWithRetry(project, startGeneration)
    } catch (err) {
      console.error(`[${new Date().toISOString()}] reconcile failed for ${project.repo}:`, err)
    }
  }
}
