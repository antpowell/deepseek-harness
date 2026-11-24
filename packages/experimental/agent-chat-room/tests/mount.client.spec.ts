// @vitest-environment jsdom
/** Browser registration, Remote actions, and complete contribution disposal. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  RemoteError, type RemoteResult, type RemoteStreamHandle, type TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import chatRoomRemote from '@deepseek-ai/dsh-agent-chat-room/remote'
import type { ChatRoomPanelInjected } from '../src/client/ChatRoomPanel.tsx'
import { ChatRoomButton } from '../src/client/ChatRoomButton.tsx'
import { ChatRoomPanel } from '../src/client/ChatRoomPanel.tsx'
import { mountChatRoom } from '../src/client/mount.ts'
import type { ChatRoomFrame, ChatRoomMessage, ChatRoomSnapshot } from '../src/types.ts'

const REMOTE: TypertRemoteContribution = chatRoomRemote
const OK: RemoteResult<void> = { ok: true, value: undefined }
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

function room(): ChatRoomSnapshot {
  return {
    roomId: SessionId('root'), label: 'Planning', members: [], messages: [], maxMembers: 16, maxMessageLength: 4096,
  }
}

function message(): ChatRoomMessage {
  return {
    id: 'message', content: 'Ready', postedAt: 1,
    author: { sessionId: SessionId('root'), name: 'Head Orchestrator', role: 'orchestrator' },
  }
}

function remoteStream(signal = new AbortController().signal): RemoteStreamHandle<ChatRoomFrame, never> {
  let dispose: () => void = () => {}
  const handle: RemoteStreamHandle<ChatRoomFrame, never> = {
    dispose: vi.fn(() => { dispose() }),
    send: vi.fn(),
    end: vi.fn(),
    async *[Symbol.asyncIterator]() {
      await new Promise<void>((resolve) => { dispose = resolve })
      void signal
    },
  }
  return handle
}

it('registers the tab and composer action, routes Remote results, and unloads cleanly', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const unmountRemote = vi.fn(async () => {})
  class Remotes extends Service {
    readonly $host: RemoteHostFacts = { home: '/home/test', isLoopback: true }
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
      expect(contribution).toBe(REMOTE)
      return unmountRemote
    }
  }
  new Remotes()
  const follow = vi.fn((_: SessionId, signal?: AbortSignal) => remoteStream(signal))
  const remote = {
    follow,
    create: vi.fn(async (_: SessionId, _label?: string): Promise<RemoteResult<ChatRoomSnapshot>> => ({ ok: true, value: room() })),
    post: vi.fn(async (_: SessionId, _content: string): Promise<RemoteResult<ChatRoomMessage>> => ({ ok: true, value: message() })),
    close: vi.fn(async (_: SessionId): Promise<RemoteResult<void>> => OK),
  }
  ctx.provide('remote.agentChatRoom', remote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const unregisterTab = vi.fn()
  const registerTab = vi.fn((_definition: SidebarRightTabDefinition) => unregisterTab)
  ctx.provide('sidebarRightTabs', { register: registerTab })
  const sidebarRight = { openTab: vi.fn() }
  ctx.provide('sidebarRight', sidebarRight)
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)

  const dispose = await mountChatRoom(ctx, REMOTE)
  expect(registerTab).toHaveBeenCalledOnce()
  const tab = ctx.slots.entries('sidebar.right.pane.tab').find(entry => entry.component === ChatRoomPanel)
  const button = ctx.slots.entries('conversation.input.dock').find(entry => entry.component === ChatRoomButton)
  expect(tab).toBeDefined()
  expect(button).toBeDefined()
  const injected = tab!.inject!(SessionId('root') as never)
  const tabFace: ChatRoomPanelInjected = {
    hooks: injected.hooks as ChatRoomPanelInjected['hooks'],
    reconnect: injected.reconnect as ChatRoomPanelInjected['reconnect'],
    create: injected.create as ChatRoomPanelInjected['create'],
    post: injected.post as ChatRoomPanelInjected['post'],
    close: injected.close as ChatRoomPanelInjected['close'],
  }
  const buttonFace = button!.inject!(SessionId('root') as never) as { open: () => void }
  buttonFace.open()
  expect(sidebarRight.openTab).toHaveBeenCalledWith('agent-chat-room')

  const changed = vi.fn()
  const stop = tabFace.hooks.room.subscribe(changed)
  expect(follow).toHaveBeenCalledWith(SessionId('root'), expect.any(AbortSignal))
  await expect(tabFace.create('Planning')).resolves.toBeUndefined()
  await expect(tabFace.post('Ready')).resolves.toBeUndefined()
  await expect(tabFace.close()).resolves.toBeUndefined()
  expect(remote.create).toHaveBeenCalledWith(SessionId('root'), 'Planning')
  expect(remote.post).toHaveBeenCalledWith(SessionId('root'), 'Ready')
  expect(remote.close).toHaveBeenCalledWith(SessionId('root'))
  remote.create.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'Room is full', {}) })
  await expect(tabFace.create('Again')).resolves.toBe('Room is full')

  await dispose()
  expect(ctx.slots.entries('sidebar.right.pane.tab')).toEqual([])
  expect(ctx.slots.entries('conversation.input.dock')).toEqual([])
  expect(unregisterTab).toHaveBeenCalledOnce()
  expect(unmountRemote).toHaveBeenCalledOnce()
  stop()
  expect(ctx.locale.bind('agentChatRoom')('open')).toBe('open')
})
