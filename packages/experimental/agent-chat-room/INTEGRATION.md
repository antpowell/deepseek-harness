# Integration Guide

## Start from this checkout

From the DeepSeek Harness checkout root, start Web with the source overlay:

```sh
pnpm dsh --profile web --patch ./packages/experimental/agent-chat-room/cordis.source.patch.yml
```

The overlay adds the chat room while the application boots. The default Web profile does not include it.

If Web is already running without the overlay, stop it and restart with this command. This integration has no in-app activation control.

For an installed package, `example-profile.patch.yml` shows the equivalent package-name row and optional configuration.
