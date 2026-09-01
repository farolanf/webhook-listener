import child_process from "node:child_process"
import { validateSignature } from "./secret"

let currentProcess: child_process.ChildProcess | null = null
let currentRetryTimer: ReturnType<typeof setTimeout> | null = null
// Bumped whenever a build is superseded/cancelled. An in-flight retry loop
// captures the generation it started under and bails the moment it changes,
// so a newer webhook never runs in parallel with a retry of an older one.
let generation = 0

// Only ever called when a build is about to take the cancelled one's place, so
// the stack is never left in whatever half-recreated state the kill produced.
// `supersededBy` names what replaced it — without this line a cancel is silent,
// because the superseded retry loop bails without logging or rethrowing.
export function cancelCurrentBuild(supersededBy?: string) {
  generation++
  if (currentRetryTimer) {
    clearTimeout(currentRetryTimer)
    currentRetryTimer = null
  }
  if (currentProcess) {
    console.log(`[${new Date().toISOString()}] cancelling in-flight build, superseded by ${supersededBy ?? 'a new build'}`)
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
      // A delivery whose body carries no object under its own event name cannot
      // satisfy a detail filter. Answering false keeps a malformed payload from
      // throwing out of the match test, which now runs before anything is killed.
      const details = payload?.[event]
      for (const key in allowedEvent) {
        if (key === 'event') {
          if (event !== allowedEvent[key]) return false
        } else if (!details) {
          return false
        } else if (key === 'head_branch') {
          if (!matchHeadBranch(details[key], (allowedEvent as any)[key])) return false
        } else if (details[key] !== (allowedEvent as any)[key]) return false
      }
      return true
    } else {
      throw new Error(`Invalid event type: ${typeof allowedEvent} ${JSON.stringify(allowedEvent)}`)
    }
  })
}

// Does this delivery ask THIS project to build? Total by design: an unsigned,
// truncated or malformed delivery is a non-match, never an exception, because
// the answer decides whether a running deploy gets killed.
function matchesProject(project: Project, event: string, payload: any, signature: string): boolean {
  if (project.repo !== payload?.repository?.full_name) return false
  if (!isEventAllowed(event, project.events, payload)) return false
  try {
    return validateSignature(signature, project.secret, payload)
  } catch {
    // timingSafeEqual throws when the buffers differ in length — an absent or
    // truncated X-Hub-Signature-256. Not a match, and not a reason to kill a deploy.
    return false
  }
}

// What to call a delivery in the line that reports a cancelled build.
function describeDelivery(event: string, payload: any): string {
  const details = payload?.[event]
  const name = details?.name && details?.head_branch ? `${details.name}@${details.head_branch}` : details?.name
  return [payload?.repository?.full_name, event, payload?.action, name].filter(Boolean).join(' ')
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
// silently if a newer build supersedes this one mid-flight (generation changed) —
// cancelCurrentBuild has already logged that, and the newer build converges the stack.
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

// A hook subscribes to whole event types, so the listener is delivered every
// event of that type in the repo — every workflow, every branch, every action.
// Match FIRST and cancel only when this delivery has a build to put in the
// cancelled one's place; a delivery that matches nothing must leave the running
// deploy alone.
//
// Cancelling before the match test means any unrelated workflow can SIGTERM a
// deploy mid-flight — between `docker compose` removing the old containers and
// starting the new ones, that leaves every container created and none started,
// with nothing queued to finish the job.
export async function run(event: string, payload: any, config: WebhookListenerConfig, signature: string) {
  const matched = config.projects.filter(project => matchesProject(project, event, payload, signature))
  if (!matched.length) return

  cancelCurrentBuild(describeDelivery(event, payload))
  const startGeneration = generation

  for (const project of matched) {
    if (generation !== startGeneration) return

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
  cancelCurrentBuild('reconcile on boot')
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
