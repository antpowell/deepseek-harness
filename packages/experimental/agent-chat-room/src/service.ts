/**
 * Agent chat room service and Host Remote.
 *
 * Maintains in-memory chat rooms keyed by orchestrator session id. Each room
 * is a shared space where the user (orchestrator) and subagents converse.
 * Messages are durable only on the orchestrator session log and through the
 * subagent inbox messages forwarded by this service.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendPluginRecord, type SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import type {
  ChatRoom, ChatRoomFrame, ChatRoomMessage, ChatRoomSnapshot, MemberRole, RoomMember,
} from './types.ts'

export interface AgentChatRoomConfig {
  /** Maximum members per room. */
  maxMembers: number
  /** Maximum message length in characters. */
  maxMessageLength: number
}

interface RoomWatcher {
  version: number
  readonly followers: Set<() => void>
}

export class AgentChatRoomService extends TypertRemoteService {
  private readonly subagents: SubagentRuntime
  private readonly config: AgentChatRoomConfig
  private readonly rooms = new Map<SessionId, ChatRoom>()
  private readonly watchers = new Map<SessionId, RoomWatcher>()

  constructor(ctx: Context, subagents: SubagentRuntime, config: AgentChatRoomConfig) {
    super(ctx, 'agentChatRooms', { namespace: 'agentChatRoom' })
    this.subagents = subagents
    this.config = config
    ctx.logger?.info(
      `[agent-chat-room] service constructed maxMembers=${config.maxMembers} maxMessageLength=${config.maxMessageLength}`,
    )
  }

  /**
   * Create the room of a live orchestrator for the browser.
   * @param agent - orchestrator whose session owns the room.
   * @param label - optional human-readable label; blank uses the default.
   * @returns the created room snapshot.
   */
  @Remote
  create(agent: Agent, label?: string): ChatRoomSnapshot {
    return snapshotOf(this.createRoom(agent, label ?? ''))
  }

  /**
   * Post to the room owned by the live orchestrator.
   * @param agent - orchestrator posting as Head Orchestrator.
   * @param content - message text.
   * @returns the committed message.
   */
  @Remote
  async post(agent: Agent, content: string): Promise<ChatRoomMessage> {
    return await this.postMessage(agent.id, agent.id, content)
  }

  /**
   * Close the room owned by the live orchestrator.
   * @param agent - orchestrator whose room closes.
   */
  @Remote
  close(agent: Agent): void {
    this.closeRoom(agent.id)
  }

  /**
   * Stream the current room frame first, then each committed membership,
   * message, creation, or closure change until cancellation.
   * @param agent - orchestrator whose room is followed.
   * @param signal - ends the stream.
   * @returns room frames in publication order; slow readers may skip intermediate frames.
   */
  @Remote({ mode: 'stream' })
  async *follow(agent: Agent, signal: AbortSignal): AsyncIterable<ChatRoomFrame> {
    const watcher = this.watcherFor(agent.id)
    let wake: (() => void) | undefined
    const notify = (): void => { wake?.() }
    watcher.followers.add(notify)
    signal.addEventListener('abort', notify)
    this.ctx.logger?.info(`[agent-chat-room] follow opened session=${agent.id} followers=${watcher.followers.size}`)
    let frames = 0
    try {
      let delivered = -1
      while (!signal.aborted) {
        if (watcher.version !== delivered) {
          delivered = watcher.version
          const frame = this.frameOf(agent.id)
          frames += 1
          if (frames === 1) {
            this.ctx.logger?.info(
              `[agent-chat-room] follow first frame session=${agent.id}`
              + ` room=${String(frame.room !== null)} members=${frame.room?.members.length ?? 0}`
              + ` messages=${frame.room?.messages.length ?? 0}`,
            )
          }
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } catch (error) {
      this.ctx.logger?.warn(`[agent-chat-room] follow failed session=${agent.id}: ${stringifyError(error)}`)
      throw error
    } finally {
      watcher.followers.delete(notify)
      signal.removeEventListener('abort', notify)
      this.ctx.logger?.info(
        `[agent-chat-room] follow closed session=${agent.id} frames=${frames} followers=${watcher.followers.size}`,
      )
    }
  }

  /**
   * Create a chat room bound to the orchestrator session.
   * @param orchestrator - the live orchestrator agent.
   * @param label - human-readable room label.
   * @returns the new room.
   */
  createRoom(orchestrator: Agent, label: string): ChatRoom {
    if (this.rooms.has(orchestrator.id)) {
      throw new Error(`Chat room already exists for orchestrator ${orchestrator.id}`)
    }
    const room: ChatRoom = {
      roomId: orchestrator.id,
      label: label.trim() || 'Agent Chat Room',
      members: new Map<SessionId, RoomMember>(),
      messages: [],
      maxMembers: this.config.maxMembers,
      maxMessageLength: this.config.maxMessageLength,
      closed: false,
    }
    room.members.set(orchestrator.id, {
      sessionId: orchestrator.id,
      name: 'Head Orchestrator',
      role: 'orchestrator',
      joinedAt: Date.now(),
    })
    this.rooms.set(orchestrator.id, room)
    this.emit(orchestrator.id)
    this.ctx.logger?.info(`[agent-chat-room] room created room=${room.roomId} label="${room.label}" members=${room.members.size}`)
    return room
  }

  /**
   * Close a room. New posts are rejected; existing members are notified.
   * @param roomId - orchestrator session id of the room.
   */
  closeRoom(roomId: SessionId): void {
    const room = this.rooms.get(roomId)
    if (room === undefined) return
    room.closed = true
    this.rooms.delete(roomId)
    this.emit(roomId)
    this.ctx.logger?.info(`[agent-chat-room] room closed room=${roomId}`)
  }

  /**
   * Add a member to a room.
   * @param roomId - room to join.
   * @param agent - live agent joining.
   * @param name - display name.
   * @param role - member role.
   */
  joinRoom(roomId: SessionId, agent: Agent, name: string, role: MemberRole = 'agent'): void {
    const room = this.rooms.get(roomId)
    if (room === undefined) throw new Error(`Chat room ${roomId} does not exist`)
    if (room.closed) throw new Error(`Chat room ${roomId} is closed`)
    if (room.members.has(agent.id)) return
    // Observers listen only and never consume a member seat.
    const occupied = [...room.members.values()].filter(member => member.role !== 'observer').length
    if (occupied >= room.maxMembers) {
      throw new Error(`Chat room ${roomId} is full (max ${room.maxMembers})`)
    }
    const trimmed = name.trim() || `agent-${agent.id.slice(0, 8)}`
    room.members.set(agent.id, {
      sessionId: agent.id,
      name: trimmed,
      role,
      joinedAt: Date.now(),
    })
    this.emit(roomId)
    this.ctx.logger?.info(`[agent-chat-room] member joined room=${roomId} session=${agent.id} name="${trimmed}" role=${role} members=${room.members.size}`)
  }

  /**
   * Post a message to a room from one of its members. The browser snapshot
   * changes only after the orchestrator session accepts the durable record.
   * @param roomId - room id.
   * @param senderId - session id of the posting member.
   * @param content - message text.
   * @returns the accepted message.
   */
  async postMessage(roomId: SessionId, senderId: SessionId, content: string): Promise<ChatRoomMessage> {
    const room = this.rooms.get(roomId)
    if (room === undefined) throw new Error(`Chat room ${roomId} does not exist`)
    if (room.closed) throw new Error(`Chat room ${roomId} is closed`)
    const sender = room.members.get(senderId)
    if (sender === undefined) throw new Error(`Session ${senderId} is not a member of room ${roomId}`)

    const trimmed = content.trim()
    if (trimmed.length === 0) throw new Error('Message content cannot be empty')
    if (trimmed.length > room.maxMessageLength) {
      throw new Error(`Message exceeds ${room.maxMessageLength} characters`)
    }

    const message: ChatRoomMessage = {
      id: randomUUID(),
      author: {
        sessionId: sender.sessionId,
        name: sender.name,
        role: sender.role,
      },
      content: trimmed,
      postedAt: Date.now(),
    }

    // Persist on the orchestrator session log as a plugin record.
    const orchestrator = this.ctx.agents.get(room.roomId)
    if (orchestrator !== undefined) {
      appendPluginRecord(orchestrator.session, 'plugin:agent-chat-room/message', {
        roomId: room.roomId,
        label: room.label,
        message: {
          id: message.id,
          author: {
            sessionId: message.author.sessionId,
            name: message.author.name,
            role: message.author.role,
          },
          content: message.content,
          postedAt: message.postedAt,
        },
      })
    }
    room.messages.push(message)
    this.emit(roomId)
    this.ctx.logger?.info(`[agent-chat-room] message accepted room=${roomId} sender=${sender.name} id=${message.id} length=${trimmed.length}`)

    // Forward the message to every other live member via the subagent runtime.
    const forwardContent = `[${room.label}] ${sender.name}: ${trimmed}`
    const textBlock = { type: 'text' as const, text: forwardContent }
    const forwarding: Promise<unknown>[] = []
    for (const member of room.members.values()) {
      if (member.sessionId === senderId) continue
      const target = this.ctx.agents.get(member.sessionId)
      if (target === undefined) {
        this.ctx.logger?.warn(`[agent-chat-room] forward skipped room=${roomId} member="${member.name}" session=${member.sessionId}: agent not live`)
        continue
      }
      forwarding.push(
        this.subagents.sendMessage(
          this.senderAgent(senderId),
          member.sessionId,
          [textBlock],
          { signal: new AbortController().signal },
        ).catch((error: unknown) => {
          this.ctx.logger?.warn(`Failed to forward chat message to ${member.sessionId}: ${stringifyError(error)}`)
        }),
      )
    }
    await Promise.allSettled(forwarding)
    this.ctx.logger?.info(`[agent-chat-room] message forwarded room=${roomId} id=${message.id} targets=${forwarding.length}`)

    return message
  }

  /**
   * Broadcast an orchestrator (user) message to all room members.
   * This is called when the user types in the orchestrator chat.
   * @param roomId - room id.
   * @param content - user message text.
   */
  async broadcastOrchestratorMessage(roomId: SessionId, content: string): Promise<ChatRoomMessage | undefined> {
    const room = this.rooms.get(roomId)
    if (room === undefined) return undefined
    return this.postMessage(roomId, roomId, content)
  }

  /** Look up a room by id. */
  getRoom(roomId: SessionId): ChatRoom | undefined {
    return this.rooms.get(roomId)
  }

  /** List active rooms. */
  listRooms(): readonly ChatRoom[] {
    return [...this.rooms.values()]
  }

  /** Whether the session is a known member of any active room. */
  roomOf(sessionId: SessionId): ChatRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.members.has(sessionId)) return room
    }
    return undefined
  }

  private watcherFor(roomId: SessionId): RoomWatcher {
    let watcher = this.watchers.get(roomId)
    if (watcher === undefined) {
      watcher = { version: 0, followers: new Set() }
      this.watchers.set(roomId, watcher)
    }
    return watcher
  }

  private emit(roomId: SessionId): void {
    const watcher = this.watchers.get(roomId)
    if (watcher === undefined) return
    watcher.version += 1
    for (const notify of [...watcher.followers]) notify()
  }

  private frameOf(roomId: SessionId): ChatRoomFrame {
    const room = this.rooms.get(roomId)
    return { room: room === undefined ? null : snapshotOf(room) }
  }

  private senderAgent(sessionId: SessionId): Agent {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error(`Sender agent ${sessionId} is not live`)
    return agent
  }
}

function snapshotOf(room: ChatRoom): ChatRoomSnapshot {
  return {
    roomId: room.roomId,
    label: room.label,
    members: [...room.members.values()],
    messages: [...room.messages],
    maxMembers: room.maxMembers,
    maxMessageLength: room.maxMessageLength,
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
