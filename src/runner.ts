import child_process from "node:child_process"

export async function run(payload: any, config: WebhookListenerConfig) {
  const promises = config.projects.map(project => {
    return new Promise<void>((resolve, reject) => {
      if (project.repo !== payload.repository.full_name) return
      if (project.secret !== payload.hook.config.secret) return

      const eventAllowed = payload.hook.events.find((event: string) => {
        return (project.events || ['push']).includes(event)
      })
      if (!eventAllowed) return

      try {
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