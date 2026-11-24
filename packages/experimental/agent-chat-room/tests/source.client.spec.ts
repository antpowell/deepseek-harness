/** Room stream sharing, reset handling, reconnect, and teardown. */

import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, type Mock, vi } from 'vitest'
import { createChatRoomSource, type ChatRoomStream } from '../src/client/source.ts'
import type { ChatRoomFrame } from '../src/types.ts'

interface TestStream extends ChatRoomStream {
  readonly signal: AbortSignal
  readonly disposed: Mock<() => void>
  push: (frame: ChatRoomFrame) => void
  finish: () => void
  fail: (error: Error) => void
}

function stream(signal: AbortSignal): TestStream {
  const queue: ChatRoomFrame[] = []
  let wake: (() => void) | undefined
  let ended = false
  let failure: Error | undefined
  const handle: TestStream = {
    signal,
    disposed: vi.fn<() => void>(),
    push(frame) { queue.push(frame); wake?.() },
    finish() { ended = true; wake?.() },
    fail(error) { failure = error; wake?.() },
    dispose() { handle.disposed(); ended = true; wake?.() },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const frame = queue.shift()
        if (frame !== undefined) { yield frame; continue }
        if (failure !== undefined) throw failure
        if (ended || signal.aborted) return
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    },
  }
  return handle
}

function fixture() {
  const streams: TestStream[] = []
  let reset: (() => void) | undefined
  const unsubscribeReset = vi.fn()
  const source = createChatRoomSource({
    open: vi.fn<(signal: AbortSignal) => ChatRoomStream>((signal: AbortSignal) => {
      const value = stream(signal)
      streams.push(value)
      return value
    }),
    subscribeReset: vi.fn((listener: () => void) => { reset = listener; return unsubscribeReset }),
  })
  return {
    source,
    streams,
    reset: () => reset?.(),
    unsubscribeReset,
    frame: (label: string): ChatRoomFrame => ({ room: {
      roomId: SessionId('root'), label, members: [], messages: [], maxMembers: 16, maxMessageLength: 4096,
    } }),
  }
}

it('opens for the first subscriber and closes after the last one leaves', async () => {
  const f = fixture()
  const first = vi.fn()
  const second = vi.fn()
  expect(f.source.observable.getSnapshot()).toEqual({ frame: null, disconnected: false })
  const stopFirst = f.source.observable.subscribe(first)
  const stopSecond = f.source.observable.subscribe(second)
  expect(f.streams).toHaveLength(1)

  f.streams[0]!.push(f.frame('Planning'))
  await vi.waitFor(() => {
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
    expect(f.source.observable.getSnapshot().frame?.room?.label).toBe('Planning')
  })
  stopFirst()
  expect(f.streams[0]!.disposed).not.toHaveBeenCalled()
  stopSecond()
  expect(f.streams[0]!.disposed).toHaveBeenCalledOnce()
  expect(f.streams[0]!.signal.aborted).toBe(true)
  expect(f.unsubscribeReset).toHaveBeenCalledOnce()

  const stopAgain = f.source.observable.subscribe(first)
  expect(f.streams).toHaveLength(2)
  f.source.close()
  expect(f.streams[1]!.disposed).toHaveBeenCalledOnce()
  stopAgain()
  expect(f.unsubscribeReset).toHaveBeenCalledTimes(2)
})

it('marks an ended or failed stream disconnected and retries on demand', async () => {
  const f = fixture()
  const stop = f.source.observable.subscribe(() => {})
  f.streams[0]!.finish()
  await vi.waitFor(() => { expect(f.source.observable.getSnapshot().disconnected).toBe(true) })
  f.source.reconnect()
  expect(f.streams).toHaveLength(2)
  expect(f.source.observable.getSnapshot().disconnected).toBe(false)

  f.streams[1]!.fail(new Error('connection lost'))
  await vi.waitFor(() => { expect(f.source.observable.getSnapshot().disconnected).toBe(true) })
  f.source.reconnect()
  f.source.reconnect()
  expect(f.streams).toHaveLength(3)
  f.source.close()
  stop()
})

it('reopens on transport reset and ignores completion from the replaced stream', async () => {
  const f = fixture()
  const changed = vi.fn()
  const stop = f.source.observable.subscribe(changed)
  f.streams[0]!.push(f.frame('Before reset'))
  await vi.waitFor(() => { expect(f.source.observable.getSnapshot().frame?.room?.label).toBe('Before reset') })
  changed.mockClear()
  f.reset()
  expect(f.streams).toHaveLength(2)
  expect(f.streams[0]!.disposed).toHaveBeenCalledOnce()

  f.streams[0]!.push(f.frame('Stale'))
  f.streams[0]!.finish()
  f.streams[1]!.push(f.frame('After reset'))
  await vi.waitFor(() => { expect(f.source.observable.getSnapshot().frame?.room?.label).toBe('After reset') })
  expect(f.source.observable.getSnapshot().disconnected).toBe(false)
  f.source.close()
  stop()
})

it('does not reconnect after an explicit close', () => {
  const f = fixture()
  const stop = f.source.observable.subscribe(() => {})
  f.source.close()
  f.source.reconnect()
  f.reset()
  expect(f.streams).toHaveLength(1)
  stop()
})
