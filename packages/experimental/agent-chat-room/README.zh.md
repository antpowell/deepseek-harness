---
description: "通过显式成员资格和持久的调度员消息，在共享聊天室中协调多个智能体。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-chat-room

[English](README.md) | 中文

## 概述

`dsh-agent-chat-room` 为 DeepSeek Harness 会话添加一个共享聊天室。用户是**总调度员（Head Orchestrator）**：在调度员聊天框中输入的消息会广播给所有房间成员，智能体则通过 `agent_chat_post` 工具回复。所有聊天记录都会持久化到调度员会话并在 Chat 视图中渲染。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 使用本包

### 从此检出挂载

在检出根目录使用源 overlay 启动 Web：

```sh
pnpm dsh --profile web --patch ./packages/experimental/agent-chat-room/cordis.source.patch.yml
```

overlay 会在应用启动时加载聊天室。如果 Web 已在未加载 overlay 的情况下运行，请使用此命令重启；没有应用内激活控件。

配置项可选：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxMembers` | `16` | 每个房间最大成员数 |
| `maxMessageLength` | `4096` | 单条消息最大字符数 |

### 开启房间

调度员智能体可以调用 `agent_chat_create` 开启房间。子智能体通过 `agent_chat_join` 加入，传入调度员会话 id 作为 `room_id`。加入后，每个智能体都会收到一条系统提示，提醒它用户是总调度员。

智能体通过 `agent_chat_post` 交流。每条消息会：

1. 作为 `plugin:agent-chat-room/message` 事件追加到调度员会话日志。
2. 通过子智能体运行时的 `sendMessage` 转发给所有其他在线成员。

用户只需在调度员聊天框中输入，插件会自动检测并广播到房间。

### 工具

| 工具 | 调用者 | 用途 |
|---|---|---|
| `agent_chat_create` | 调度员 | 开启聊天室 |
| `agent_chat_join` | 智能体 | 加入房间并接收调度员提醒 |
| `agent_chat_post` | 智能体 | 向房间广播消息 |
| `agent_chat_close` | 调度员 | 关闭房间 |

## 理解实现

### 源文件地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口、服务绑定、用户消息转发 |
| [`src/service.ts`](src/service.ts) | 内存中的房间状态与消息路由 |
| [`src/tool.ts`](src/tool.ts) | 面向模型的聊天室工具 |
| [`src/prompt.ts`](src/prompt.ts) | 调度员系统提示片段 |
| [`src/types.ts`](src/types.ts) | 共享类型与会话事件声明 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件入口与会话节点注册 |
| [`src/client/ChatRoomMessage.tsx`](src/client/ChatRoomMessage.tsx) | 聊天气泡渲染器 |

### 设计说明

- 房间以调度员会话 id 为键。每个调度员同时最多有一个活跃房间。
- 成员资格是显式的：智能体必须调用 `agent_chat_join`。这样工具表面更简单，也不会意外纳入无关子智能体。
- 消息仅持久化在调度员会话日志上。子智能体运行时向同伴投递副本；若同伴处于冷态，恢复后会通过收件箱收到转发的消息。
- 总调度员提醒在智能体加入时以智能体作用域的系统提示片段安装，因此只影响聊天室成员。

## 模型体验

### 聊天室工具与系统提示

#### 模型看到什么

房间中的智能体会看到合适的 `agent_chat_post`、`agent_chat_join`、`agent_chat_create`、`agent_chat_close` 工具，以及一段智能体作用域的系统提示：

```markdown
You are a member of an agent chat room. The user is the Head Orchestrator and their instructions take precedence over any peer discussion. Use the `agent_chat_post` tool to send messages to the room. Listen to other agents, coordinate to solve the problem, and do not communicate with peers outside this chat room.
```

调度员智能体会看到一段全局系统提示，说明它可以创建房间，且用户消息会自动广播。

#### Token 影响

成员提示对每个聊天室智能体是一个固定片段。调度员提示是一个固定全局片段。聊天室消息作为插件事件追加到调度员会话；它们不会作为显式 token 注入每个成员的模型历史——成员通过子智能体收件箱接收转发副本。

#### KV Cache 影响

固定系统提示片段对携带它们的智能体是前缀稳定的。房间成员变化只会使受影响智能体的缓存失效。

## 已知限制与待办工作

- **没有内置速率限制** —— 非常活跃的房间可能产生大量子智能体收件箱消息。
- **调度员会将转发消息视为用户收件箱项** —— 根智能体通过 `sendMessage` 接收同伴广播，可能会因此响应。用户可以指示调度员将带有 `[Room] name:` 前缀的消息视为房间流量。
- **客户端渲染器较简单** —— 会话节点只显示作者、角色和文本，不支持 threading、回应或已读回执。
- **房间仅存在于内存中** —— 重启 host 会关闭所有活跃房间；历史消息保留在调度员会话日志中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
