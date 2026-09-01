# webhook-listener

## Configuration

Example

```yaml
reload_config: false
projects:
  - repo: farolanf/somerepo
    secret: my-webhook-secret
    events:
      - push
      - event: workflow_run
        status: completed
    dir: /app
    command: ./restart
    retries: 2
    retry_delay: 5000
```
- `reload_config`: reload config on every webhook event
- `projects`
  - `repo` full repository name in the form of `<username>/<repo_name>`
  - `secret` the repo webhook secret
  - `events` allowed events. Defaults to `["push"]`
  - `dir` working dir for the command (optional)
  - `command` command to run on webhook event
  - `retries` times to re-run `command` if it exits non-zero, so a transient
    failure doesn't leave the stack half-deployed. Defaults to `0` (optional)
  - `retry_delay` milliseconds to wait between retries. Defaults to `0` (optional)

## Superseding a running build

A delivery cancels the build in flight **only when it matches a project itself**, so
the cancelled build is always replaced by one that converges the stack. A GitHub hook
subscribes to whole event types, not to one workflow: subscribe to `workflow_run` and
you are delivered every workflow in the repo, on every branch, for `requested`,
`in_progress` and `completed` alike. Cancelling before the match test therefore lets any
unrelated workflow kill a deploy in flight — and between `docker compose` removing the
old containers and starting the new ones, that leaves every container created, none
started, and nothing queued to finish the job. The cancellation is logged, naming the
delivery that superseded it.

Matching never throws: an unsigned, truncated or malformed delivery is a non-match, not
an exception, because that answer decides whether a running deploy is killed.

## Reconcile on boot

On startup the listener replays every project's `command` once, sequentially,
before waiting for webhooks. Deploy commands (e.g. `docker compose up -d --build`)
are idempotent, so replaying them converges a deploy that was interrupted by a
restart or reboot instead of leaving the stack down until the next webhook. A
webhook arriving mid-reconcile supersedes it, so the two never run in parallel.

## Command Line Arguments
- `-c, --config` path to config file. Defaults to `./webhook-listener.yml`
- `-p, --port` port to listen on. Defaults to `8385`