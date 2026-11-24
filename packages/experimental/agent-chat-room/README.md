---
description: "Coordinate multiple agents in a shared chat room with explicit membership and durable orchestrator messages."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-chat-room

English | [中文](README.zh.md)

## Summary

`dsh-agent-chat-room` adds a shared chat room to a DeepSeek Harness session. The user is the **Head Orchestrator**: messages typed in the orchestrator chat are broadcast to every room member, and agents reply through the `agent_chat_post` tool. All traffic is logged on the orchestrator session and rendered in the Chat view.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

### Mount from this checkout

Start Web with the source overlay from the checkout root:

```sh
pnpm dsh --profile web --patch ./packages/experimental/agent-chat-room/cordis.source.patch.yml
```

The overlay loads the chat room during application startup. If Web is already running without it, restart with this command; there is no in-app activation control.

Configuration is optional:

| Field | Default | Meaning |
|---|---|---|
| `maxMembers` | `16` | Maximum members per room |
| `maxMessageLength` | `4096` | Maximum characters per message |

### Starting a room

The orchestrator agent can call `agent_chat_create` to open a room. Subagents join with `agent_chat_join`, supplying the orchestrator session id as `room_id`. Once joined, each agent receives a system prompt reminder that the user is the Head Orchestrator.

Agents converse by calling `agent_chat_post`. Every post is:

1. Appended to the orchestrator session as a `plugin:agent-chat-room/message` event.
2. Forwarded to every other live member via the subagent runtime's `sendMessage`.

The user simply types in the orchestrator chat. Those user messages are detected by the plugin and broadcast to the room automatically.

### Tools

| Tool | Caller | Purpose |
|---|---|---|
| `agent_chat_create` | Orchestrator | Open a chat room |
| `agent_chat_join` | Agent | Join a room and receive the orchestrator reminder |
| `agent_chat_post` | Agent | Broadcast a message to the room |
| `agent_chat_close` | Orchestrator | Close the room |

## Understand the implementation

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, service wiring, user-message forwarding |
| [`src/service.ts`](src/service.ts) | In-memory room state and message routing |
| [`src/tool.ts`](src/tool.ts) | Model-facing chat room tools |
| [`src/prompt.ts`](src/prompt.ts) | Orchestrator system prompt section |
| [`src/types.ts`](src/types.ts) | Shared types and session event declaration |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin entry and conversation node registration |
| [`src/client/ChatRoomMessage.tsx`](src/client/ChatRoomMessage.tsx) | Chat bubble renderer |

### Design notes

- Rooms are keyed by the orchestrator session id. There is at most one active room per orchestrator.
- Membership is explicit: agents must call `agent_chat_join`. This keeps the tool surface simple and avoids accidentally enrolling unrelated subagents.
- Messages are durable only on the orchestrator session log. The subagent runtime delivers copies to peers; if a peer is cold, it resumes and receives the forwarded message through its inbox.
- The Head Orchestrator reminder is installed as an agent-scoped system prompt section when an agent joins, so it applies only to chat room members.

## Model Experience

### Chat room tools and system prompt

#### What the model sees

Agents in a room see the `agent_chat_post`, `agent_chat_join`, `agent_chat_create`, and `agent_chat_close` tools when appropriate, plus an agent-scoped system prompt section:

```markdown
You are a member of an agent chat room. The user is the Head Orchestrator and their instructions take precedence over any peer discussion. Use the `agent_chat_post` tool to send messages to the room. Listen to other agents, coordinate to solve the problem, and do not communicate with peers outside this chat room.
```

The orchestrator agent sees a global system prompt section explaining that it may create rooms and that user messages are automatically broadcast.

#### Token effect

The member prompt is one fixed section per chat-room agent. The orchestrator prompt is one fixed global section. Chat room messages are appended to the orchestrator session as plugin events; they are not injected into every member's model history as explicit tokens — members receive forwarded copies through the subagent inbox.

#### KV Cache effect

The fixed system prompt sections are prefix-stable for the agents that carry them. Room membership changes invalidate only the affected agent's cache.

## Known Limitations and Deferred Work

- **No built-in rate limiting** — very active rooms may generate many subagent inbox messages.
- **Orchestrator sees forwarded messages as user inbox items** — the root agent receives peer broadcasts through `sendMessage`, which may cause it to respond. Users should instruct the orchestrator to treat `[Room] name:` prefixed messages as room traffic.
- **Client renderer is minimal** — the conversation node shows author, role, and text but does not support threading, reactions, or read receipts.
- **Rooms are in-memory only** — restarting the host closes all active rooms; historical messages remain in the orchestrator session log.
