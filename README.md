# webhook-listener

## Configuration

Example

```yaml
projects:
  - repo: farolanf/myrepo
    secret: my-weebhook-secret
    events:
      - push
    dir: /app
    command: ./restart
```
- **repo** full repository name in the form of `<username>/<repo_name>`
- **secret** the configured webhook secret
- **events** allowed events. Defaults to `["push"]`
- **dir** working dir for the command (optional)
- **command** command to run on webhook event

## Environment Variables
- **PORT** port to listen on. Defaults to `8385`
- **CONFIG** path to config file