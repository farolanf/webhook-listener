# webhook-listener

## Configuration

Example

```yaml
reload_config: false
projects:
  - repo: farolanf/myrepo
    secret: my-weebhook-secret
    events:
      - push
    dir: /app
    command: ./restart
```
- `reload_config`: reload config on every webhook event
- `repo` full repository name in the form of `<username>/<repo_name>`
- `secret` the configured webhook secret
- `events` allowed events. Defaults to `["push"]`
- `dir` working dir for the command. Defaults to current dir
- `command` command to run on webhook event

## Command Line Arguments
- `-c, --config` path to config file. Defaults to `./webhook-listener.yml`
- `-p, --port` port to listen on. Defaults to `8385`