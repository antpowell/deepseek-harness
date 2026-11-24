/**
 * Model-facing tools for the agent chat room.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentChatRoomService } from './service.ts'
import type { MemberRole } from './types.ts'

export function registerChatRoomTools(ctx: Context, service: AgentChatRoomService): void {
  ctx.tools.register(defineTool({
    name: 'agent_chat_create',
    description:
      'Create an agent chat room for the current session. The user becomes the Head Orchestrator. '
      + 'Use this before inviting agents.',
    parameters: {
      label: {
        type: 'string',
        description: 'Optional human-readable label for the chat room.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roomId: { type: 'string', required: true },
          label: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created chat room "${value.label}" (${value.roomId}).`,
      }],
    },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('agent_chat_create requires an owning agent')
      const label = typeof args.label === 'string' ? args.label : 'Agent Chat Room'
      const room = service.createRoom(exec.agent, label)
      return Promise.resolve({ roomId: room.roomId, label: room.label })
    },
    presentCall: () => ({ card: 'generic', title: 'Create agent chat room', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'agent_chat_join',
    description:
      'Join the current agent to an existing chat room. The calling agent becomes a member and '
      + 'receives a system prompt reminding it that the user is the Head Orchestrator.',
    parameters: {
      room_id: {
        type: 'string',
        required: true,
        description: 'The orchestrator session id returned by agent_chat_create.',
      },
      name: {
        type: 'string',
        description: 'Display name for this agent in the chat room.',
      },
      role: {
        type: 'string',
        description: 'Role: agent (default) or observer.',
        enum: ['agent', 'observer'],
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roomId: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Joined chat room ${value.roomId} as ${value.name}.`,
      }],
    },
    execute(args, exec) {
      if (exec.agent === undefined) throw new Error('agent_chat_join requires an owning agent')
      const roomId = SessionId(args.room_id)
      const name = typeof args.name === 'string' ? args.name : exec.agent.id.slice(0, 8)
      const role = (args.role === 'observer' ? 'observer' : 'agent') as MemberRole
      const roomBefore = service.getRoom(roomId)
      const wasMember = roomBefore?.members.has(exec.agent.id) ?? false
      service.joinRoom(roomId, exec.agent, name, role)
      if (!wasMember) installMemberPrompt(exec.agent)
      return Promise.resolve({ roomId, name: name.trim() || exec.agent.id.slice(0, 8) })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Join agent chat room',
      kind: 'other',
      rawInput: { room: args.room_id, name: args.name },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'agent_chat_post',
    description:
      'Post a message to the agent chat room. All other members receive it in their inbox. '
      + 'The message is also logged in the orchestrator session so the user can see it.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The message text to broadcast to the room.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          messageId: { type: 'string', required: true },
          postedAt: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Posted chat message ${value.messageId} at ${new Date(value.postedAt).toISOString()}.`,
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('agent_chat_post requires an owning agent')
      const room = service.roomOf(exec.agent.id)
      if (room === undefined) throw new Error('This agent is not a member of any chat room')
      const content = typeof args.content === 'string' ? args.content : ''
      const message = await service.postMessage(room.roomId, exec.agent.id, content)
      return { messageId: message.id, postedAt: message.postedAt }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Post to chat room',
      kind: 'other',
      rawInput: args.content,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'agent_chat_close',
    description: 'Close the agent chat room for the current orchestrator session.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          roomId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Closed chat room ${value.roomId}.`,
      }],
    },
    execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('agent_chat_close requires an owning agent')
      service.closeRoom(exec.agent.id)
      return Promise.resolve({ roomId: exec.agent.id })
    },
    presentCall: () => ({ card: 'generic', title: 'Close agent chat room', kind: 'other' }),
  }))
}

/** Install an agent-scoped system prompt section reminding the member of the room rules. */
function installMemberPrompt(agent: Agent): void {
  agent.ctx.systemPrompt.section({
    name: 'agent-chat-room-orchestrator',
    order: 50,
    text:
      'You are a member of an agent chat room. The user is the Head Orchestrator and their '
      + 'instructions take precedence over any peer discussion. '
      + 'Use the `agent_chat_post` tool to send messages to the room. '
      + 'Listen to other agents, coordinate to solve the problem, and do not communicate with '
      + 'peers outside this chat room.',
  })
}
