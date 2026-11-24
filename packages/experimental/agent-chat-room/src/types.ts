/**
 * Shared types for the agent chat room plugin.
 *
 * These types are pure JSON-serializable where they cross the session log, and
 * plain TypeScript interfaces for the in-memory service.
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Role a member plays in a chat room. */
export type MemberRole = 'orchestrator' | 'agent' | 'observer'

/** One chat room member. */
export interface RoomMember {
  /** Durable session id of the member agent. */
  readonly sessionId: SessionId
  /** Display name used in the chat log and in messages forwarded to peers. */
  readonly name: string
  /** Member role; only the orchestrator may issue authoritative instructions. */
  readonly role: MemberRole
  /** When this member joined the room. */
  readonly joinedAt: number
}

/** One message posted to a chat room. */
export interface ChatRoomMessage {
  /** Stable message identity (UUID v4). */
  readonly id: string
  /** Member that authored the message. */
  readonly author: { readonly sessionId: SessionId; readonly name: string; readonly role: MemberRole }
  /** Message text content. */
  readonly content: string
  /** Unix timestamp (ms) when the message was accepted. */
  readonly postedAt: number
}

/** In-memory view of one chat room. */
export interface ChatRoom {
  /** The root orchestrator session id is also the room id. */
  readonly roomId: SessionId
  /** Human-readable label, supplied at creation. */
  readonly label: string
  /** Members keyed by session id. */
  readonly members: Map<SessionId, RoomMember>
  /** Messages in posting order. */
  readonly messages: ChatRoomMessage[]
  /** Maximum members allowed in one room. */
  readonly maxMembers: number
  /** Maximum message length in characters. */
  readonly maxMessageLength: number
  /** Whether the room is closed to new posts. */
  closed: boolean
}

/** JSON-safe room state sent to the browser. */
export interface ChatRoomSnapshot {
  /** The root orchestrator session id is also the room id. */
  readonly roomId: SessionId
  /** Human-readable room label. */
  readonly label: string
  /** Current members in joining order. */
  readonly members: readonly RoomMember[]
  /** Committed messages in posting order. */
  readonly messages: readonly ChatRoomMessage[]
  /** Maximum members allowed in the room. */
  readonly maxMembers: number
  /** Maximum message length in characters. */
  readonly maxMessageLength: number
}

/** Current room of one orchestrator, or null when no room is active. */
export interface ChatRoomFrame {
  readonly room: ChatRoomSnapshot | null
}

/** Payload of the durable plugin record the plugin appends to the orchestrator log. */
export interface AgentChatRoomMessageRecord {
  readonly roomId: SessionId
  readonly label: string
  readonly message: {
    readonly id: string
    readonly author: { readonly sessionId: SessionId; readonly name: string; readonly role: MemberRole }
    readonly content: string
    readonly postedAt: number
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    /** A member posted a message to an agent chat room. */
    'plugin:agent-chat-room/message': AgentChatRoomMessageRecord
  }
}
