import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import child_process from 'node:child_process'
import * as secret from './secret'

vi.mock('node:child_process')
vi.mock('./secret')

describe('runner', () => {
  const mockExec = child_process.exec as ReturnType<typeof vi.fn>
  const mockValidateSignature = secret.validateSignature as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('run', () => {
    it('should run builds sequentially, not in parallel', async () => {
      const callOrder: string[] = []
      let resolveCount = 0

      mockExec.mockImplementation((cmd: string) => {
        const id = ++resolveCount
        callOrder.push(`start-${id}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') {
              setTimeout(() => {
                callOrder.push(`end-${id}`)
                cb(0)
              }, 50)
            }
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [
          { repo: 'test/repo', dir: '/tmp', command: 'sleep 0.1', events: ['push'], secret: 'secret' },
          { repo: 'test/repo', dir: '/tmp', command: 'sleep 0.1', events: ['push'], secret: 'secret' }
        ]
      } as any

      await run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')

      expect(callOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
    })

    it('should cancel previous build before starting new one', async () => {
      const kills: string[] = []

      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') {
              setTimeout(() => cb(0), 200)
            }
            return proc
          },
          kill: (signal: string) => kills.push(signal)
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [
          { repo: 'test/repo', dir: '/tmp', command: 'sleep 1', events: ['push'], secret: 'secret' }
        ]
      } as any

      run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))
      run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      expect(kills.filter(k => k === 'SIGTERM')).toHaveLength(1)
    })

    it('should reject when command fails', async () => {
      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(1)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'exit 1',
          events: ['push'],
          secret: 'secret'
        }]
      } as any

      await expect(run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')).rejects.toThrow()
    })

    it('should skip projects with non-matching repo', async () => {
      const callOrder: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        callOrder.push(`exec-${cmd}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [
          { repo: 'other/repo', dir: '/tmp', command: 'echo other', events: ['push'], secret: 'secret' },
          { repo: 'test/repo', dir: '/tmp', command: 'echo test', events: ['push'], secret: 'secret' }
        ]
      } as any

      await run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')

      expect(callOrder).toEqual(['exec-echo test'])
    })

    it('should match head_branch exact', async () => {
      const callOrder: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        callOrder.push(`exec-${cmd}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'echo test',
          events: [{ event: 'workflow_run', head_branch: 'main' }],
          secret: 'secret'
        }]
      } as any

      await run('workflow_run', { repository: { full_name: 'test/repo' }, workflow_run: { head_branch: 'main' } }, fakeConfig, '')

      expect(callOrder).toEqual(['exec-echo test'])
    })

    it('should match head_branch with prefix wildcard', async () => {
      const callOrder: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        callOrder.push(`exec-${cmd}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'echo test',
          events: [{ event: 'workflow_run', head_branch: 'staging/*' }],
          secret: 'secret'
        }]
      } as any

      await run('workflow_run', { repository: { full_name: 'test/repo' }, workflow_run: { head_branch: 'staging/feature-1' } }, fakeConfig, '')

      expect(callOrder).toEqual(['exec-echo test'])
    })

    it('should skip project when head_branch does not match', async () => {
      const callOrder: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        callOrder.push(`exec-${cmd}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'echo test',
          events: [{ event: 'workflow_run', head_branch: 'main' }],
          secret: 'secret'
        }]
      } as any

      await run('workflow_run', { repository: { full_name: 'test/repo' }, workflow_run: { head_branch: 'feature-1' } }, fakeConfig, '')

      expect(callOrder).toEqual([])
    })

    it('should retry a failing command and succeed within the retry budget', async () => {
      let attempts = 0

      mockExec.mockImplementation(() => {
        const attempt = ++attempts
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(attempt < 3 ? 1 : 0), 0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo', dir: '/tmp', command: 'flaky', events: ['push'], secret: 'secret',
          retries: 3, retry_delay: 0
        }]
      } as any

      await run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')

      expect(attempts).toBe(3)
    })

    it('should reject after exhausting retries', async () => {
      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(1), 0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo', dir: '/tmp', command: 'always-fails', events: ['push'], secret: 'secret',
          retries: 2, retry_delay: 0
        }]
      } as any

      await expect(run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')).rejects.toThrow()
      expect(mockExec).toHaveBeenCalledTimes(3)
    })

    it('reconcile runs every project command once on boot', async () => {
      const cmds: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        cmds.push(cmd)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(0), 0)
            return proc
          }
        } as any
        return proc
      })

      const { reconcile } = await import('../src/runner')

      const fakeConfig = {
        projects: [
          { repo: 'a/a', dir: '/tmp', command: 'deploy-a', events: ['push'], secret: 's' },
          { repo: 'b/b', dir: '/tmp', command: 'deploy-b', events: ['push'], secret: 's' }
        ]
      } as any

      await reconcile(fakeConfig)

      expect(cmds).toEqual(['deploy-a', 'deploy-b'])
    })

    it('reconcile continues past a failing project', async () => {
      const cmds: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        cmds.push(cmd)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(cmd === 'deploy-a' ? 1 : 0), 0)
            return proc
          }
        } as any
        return proc
      })

      const { reconcile } = await import('../src/runner')

      const fakeConfig = {
        projects: [
          { repo: 'a/a', dir: '/tmp', command: 'deploy-a', events: ['push'], secret: 's' },
          { repo: 'b/b', dir: '/tmp', command: 'deploy-b', events: ['push'], secret: 's' }
        ]
      } as any

      await reconcile(fakeConfig)

      expect(cmds).toEqual(['deploy-a', 'deploy-b'])
    })

    it('should skip project when head_branch prefix does not match', async () => {
      const callOrder: string[] = []

      mockExec.mockImplementation((cmd: string) => {
        callOrder.push(`exec-${cmd}`)
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') cb(0)
            return proc
          }
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'echo test',
          events: [{ event: 'workflow_run', head_branch: 'staging/*' }],
          secret: 'secret'
        }]
      } as any

      await run('workflow_run', { repository: { full_name: 'test/repo' }, workflow_run: { head_branch: 'main/feature-1' } }, fakeConfig, '')

      expect(callOrder).toEqual([])
    })

    // A hook is subscribed to a whole event type, so every workflow_run in the
    // repo is delivered here. Cancelling before the match test lets an unrelated
    // workflow kill a deploy mid-recreate, with nothing queued to take its place.
    it('should leave a running build alone when the delivery matches no project', async () => {
      const kills: string[] = []

      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(0), 200)
            return proc
          },
          kill: (signal: string) => kills.push(signal)
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'deploy',
          events: [{ event: 'workflow_run', name: 'backend', head_branch: 'main' }],
          secret: 'secret'
        }]
      } as any

      run('workflow_run', {
        repository: { full_name: 'test/repo' },
        workflow_run: { name: 'backend', head_branch: 'main' }
      }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      // An unrelated workflow starting on somebody's PR branch.
      run('workflow_run', {
        repository: { full_name: 'test/repo' },
        workflow_run: { name: 'checks', head_branch: 'someones-pr-branch' }
      }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      expect(kills).toEqual([])
    })

    it('should leave a running build alone when the payload has no repository', async () => {
      const kills: string[] = []

      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(0), 200)
            return proc
          },
          kill: (signal: string) => kills.push(signal)
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{ repo: 'test/repo', dir: '/tmp', command: 'deploy', events: ['push'], secret: 'secret' }]
      } as any

      run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      await expect(run('ping', { zen: 'Keep it logically awesome.' }, fakeConfig, '')).resolves.toBeUndefined()

      expect(kills).toEqual([])
    })

    it('should leave a running build alone when the signature cannot be checked', async () => {
      const kills: string[] = []

      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(0), 200)
            return proc
          },
          kill: (signal: string) => kills.push(signal)
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValueOnce(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{ repo: 'test/repo', dir: '/tmp', command: 'deploy', events: ['push'], secret: 'secret' }]
      } as any

      run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      // timingSafeEqual throws on a length mismatch — an absent or truncated
      // X-Hub-Signature-256 header.
      mockValidateSignature.mockImplementation(() => { throw new Error('Input buffers must have the same byte length') })

      await expect(run('push', { repository: { full_name: 'test/repo' } }, fakeConfig, '')).resolves.toBeUndefined()

      expect(kills).toEqual([])
    })

    it('should log the build it cancels and what superseded it', async () => {
      const logs: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...args: any[]) => { logs.push(args.join(' ')) })

      mockExec.mockImplementation(() => {
        const proc = {
          on: (event: string, cb: Function) => {
            if (event === 'exit') setTimeout(() => cb(0), 200)
            return proc
          },
          kill: () => {}
        } as any
        return proc
      })

      mockValidateSignature.mockReturnValue(true)

      const { run } = await import('../src/runner')

      const fakeConfig = {
        projects: [{
          repo: 'test/repo',
          dir: '/tmp',
          command: 'deploy',
          events: [{ event: 'workflow_run', name: 'backend', head_branch: 'main' }],
          secret: 'secret'
        }]
      } as any

      const payload = {
        repository: { full_name: 'test/repo' },
        action: 'completed',
        workflow_run: { name: 'backend', head_branch: 'main' }
      }

      run('workflow_run', payload, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))
      run('workflow_run', payload, fakeConfig, '')
      await new Promise(r => setTimeout(r, 10))

      const cancelled = logs.find(line => line.includes('cancelling in-flight build'))
      expect(cancelled).toBeDefined()
      expect(cancelled).toContain('superseded by test/repo workflow_run completed backend@main')
    })
  })
})
