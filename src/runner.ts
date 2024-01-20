import child_process from "node:child_process"

export async function run(payload: any, config: WebhookListenerConfig) {
  const promises = config.projects.map(project => {
    return new Promise<void>((resolve, reject) => {
      if (
        project.repo !== payload.repository.full_name ||
        project.secret !== payload.hook.config.secret ||
        !payload.hook.events.some((event: string) => project.events.includes(event))
      ) return resolve()

      try {
        console.log(`${project.repo} (${payload.hook.events.join(',')}) ${project.dir} ${project.command}`)
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