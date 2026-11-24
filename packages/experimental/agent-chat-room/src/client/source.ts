/** Live Host room stream shared by every view of one Session. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatRoomFrame } from '../types.ts'

/** Latest room frame and whether its stream ended while subscribed. */
export interface ChatRoomStreamSnapshot {
  /** Null before the first frame arrives. */
  readonly frame: ChatRoomFrame | null
  readonly disconnected: boolean
  /** Why the stream failed or ended, when known; absent otherwise. */
  readonly error?: string
}

/** One open Host room stream. */
export interface ChatRoomStream extends AsyncIterable<ChatRoomFrame> {
  dispose: () => void
}

/** Transport operations used by the room source. */
export interface ChatRoomSourceDeps {
  /** Open the room stream; the signal aborts it. */
  readonly open: (signal: AbortSignal) => ChatRoomStream
  /** Subscribe to transport resets; returns the unsubscribe function. */
  readonly subscribeReset: (listener: () => void) => () => void
}

/** Reconnectable room state that streams only while a view subscribes. */
export interface ChatRoomSource {
  readonly observable: HostObservable<ChatRoomStreamSnapshot>
  readonly reconnect: () => void
  readonly close: () => void
}

/**
 * Create one room stream source. The first subscriber opens it and the last
 * closes it. A transport reset or an explicit retry reopens an ended stream.
 * @param deps - stream opener and reset subscription.
 * @returns the owned source.
 */
export function createChatRoomSource(deps: ChatRoomSourceDeps): ChatRoomSource {
  let snapshot: ChatRoomStreamSnapshot = { frame: null, disconnected: false }
  const listeners = new Set<() => void>()
  let running: { readonly controller: AbortController; readonly stream: ChatRoomStream } | undefined
  let stopReset: (() => void) | undefined
  const publish = (next: ChatRoomStreamSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const stop = (): void => {
    const stopped = running
    running = undefined
    stopped?.controller.abort()
    stopped?.stream.dispose()
  }
  const start = (): void => {
    const controller = new AbortController()
    let stream: ChatRoomStream
    try {
      stream = deps.open(controller.signal)
    } catch (error) {
      console.error('[agent-chat-room] room stream open failed:', error)
      publish({ ...snapshot, disconnected: true, error: stringifyError(error) })
      return
    }
    const opened = { controller, stream }
    running = opened
    if (snapshot.disconnected) publish({ frame: snapshot.frame, disconnected: false })
    void (async () => {
      let failure: string | undefined
      try {
        for await (const frame of opened.stream) {
          if (running !== opened) return
          publish({ frame, disconnected: false })
        }
      } catch (error) {
        failure = stringifyError(error)
        console.error('[agent-chat-room] room stream failed:', error)
      }
      if (running !== opened) return
      running = undefined
      publish(failure === undefined
        ? snapshot.frame === null
          ? { frame: null, disconnected: true, error: 'room stream ended before the first frame' }
          : { ...snapshot, disconnected: true }
        : { ...snapshot, disconnected: true, error: failure })
    })()
  }
  const reconnect = (): void => {
    if (listeners.size === 0 || running !== undefined) return
    start()
  }
  const close = (): void => {
    listeners.clear()
    stopReset?.()
    stopReset = undefined
    stop()
  }
  return {
    observable: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        if (listeners.size === 1) {
          stopReset = deps.subscribeReset(() => {
            stop()
            reconnect()
          })
          start()
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) close()
        }
      },
    },
    reconnect,
    close,
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
