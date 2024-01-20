# webhook-listener

## Configuration

Example

```yaml
secret: my-webhook-secret
reload_config: false
projects:
  - repo: farolanf/myrepo
    events:
      - push
    dir: /app
    command: ./restart
```
- `secret` the configured webhook secret
- `reload_config`: reload config on every webhook event
- `projects`
  - `repo` full repository name in the form of `<username>/<repo_name>`
  - `events` allowed events. Defaults to `["push"]`
  - `dir` working dir for the command. Defaults to `null`
  - `command` command to run on webhook event

## Command Line Arguments
- `-c, --config` path to config file. Defaults to `./webhook-listener.yml`
- `-p, --port` port to listen on. Defaults to `8385`