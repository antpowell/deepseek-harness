/**
 * Agent chat room plugin for DeepSeek Harness.
 *
 * Provides a shared chat room where the user (Head Orchestrator) and multiple
 * subagents communicate to solve problems together. User messages typed in the
 * orchestrator chat are forwarded to all room members, and agents broadcast
 * their replies through the `agent_chat_post` tool.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AgentChatRoomService } from './service.ts'
import { installOrchestratorPrompt } from './prompt.ts'
import { registerChatRoomTools } from './tool.ts'
import './types.ts'

export interface Config {
  /** Maximum members allowed in a single chat room. */
  maxMembers: number
  /** Maximum characters allowed in one chat message. */
  maxMessageLength: number
}

export const name = 'agent-chat-room'
export const inject = ['tools', 'agents', 'subagents', 'systemPrompt']

export const Config: z<Config> = z.object({
  maxMembers: z.number().default(16),
  maxMessageLength: z.number().default(4096),
})

export function apply(ctx: Context, config: Config): void {
  ctx.logger?.info(`[agent-chat-room] host apply from ${import.meta.url} config=${JSON.stringify(config)}`)
  const service = new AgentChatRoomService(
    ctx,
    ctx.subagents,
    { maxMembers: config.maxMembers, maxMessageLength: config.maxMessageLength },
  )

  ctx.effect(() => {
    registerChatRoomTools(ctx, service)
    installOrchestratorPrompt(ctx)
    // Observability probe: the Remote is only callable from the browser when its
    // generated manifest reached the typert registry under this package name.
    // Use ctx.get (not property access): reading an uninjected service off the
    // context throws, which would fail this effect and roll back tool registration.
    let hostManifest: unknown
    try {
      const lookup = (ctx as { get?: (name: string) => unknown }).get
      const typert = typeof lookup === 'function' ? lookup.call(ctx, 'typert') : undefined
      const getter = (typert as { getPackage?: unknown } | undefined)?.getPackage
      hostManifest = typeof getter === 'function'
        ? (getter as (name: string, face?: string) => unknown).call(typert, '@deepseek-ai/dsh-agent-chat-room', 'host')
        : undefined
    } catch {
      hostManifest = undefined
    }
    ctx.logger?.info(
      `[agent-chat-room] mounted; remote manifest registered=${hostManifest !== undefined}`,
    )
    return () => {
      for (const room of service.listRooms()) {
        service.closeRoom(room.roomId)
      }
    }
  }, 'agent-chat-room: service and tools')

  // Forward orchestrator user messages to their chat room. The listener must be
  // global: sessions are owned by other scopes (web/API controllers), and a
  // scope-local listener would never hear their events.
  ctx.on('session/event', (session, event) => {
    const roomId = session.id
    if (!isUserTypedMessage(event)) return
    const room = service.getRoom(roomId)
    if (room === undefined || room.closed) return
    const text = extractTextContent(event)
    if (text === undefined) return
    // The broadcast appends a new event to the same session. Session dispatch is
    // synchronous inside an in-flight append, which rejects reentrant appends, so
    // defer the broadcast to the next macrotask after publishing completes.
    setImmediate(() => {
      service.broadcastOrchestratorMessage(roomId, text).catch((error: unknown) => {
        ctx.logger?.warn(`Failed to broadcast orchestrator message: ${stringifyError(error)}`)
      })
    })
  }, { global: true })

}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentChatRooms: AgentChatRoomService
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isUserTypedMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message' && event.data.source.kind === 'user'
}

function extractTextContent(event: SessionEvent<'user/message'>): string | undefined {
  const blocks = event.data.content
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text)
  }
  return texts.length > 0 ? texts.join('\n') : undefined
}
