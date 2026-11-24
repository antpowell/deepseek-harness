/** Remote contribution and visible room registrations. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-chat-room/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ChatRoomButton } from './ChatRoomButton.tsx'
import { ChatRoomPanel, type ChatRoomPanelInjected } from './ChatRoomPanel.tsx'
import { en, NS, zh } from './locales.ts'
import { createChatRoomSource, type ChatRoomSource } from './source.ts'

/** Registry id of the room tab type, also its slot key. */
const TAB_ID = '@deepseek-ai/dsh-agent-chat-room'

/** Kind opened by the composer button. */
const TAB_KIND = 'agent-chat-room'

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'agent-chat-room: dictionaries')
  const t = ctx.locale.bind(NS)
  const sources = new Map<SessionId, ChatRoomSource>()
  ctx.effect(() => () => {
    for (const source of sources.values()) source.close()
    sources.clear()
  }, 'agent-chat-room: room streams')
  const sourceOf = (sessionId: SessionId): ChatRoomSource => {
    let source = sources.get(sessionId)
    if (source === undefined) {
      source = createChatRoomSource({
        open: (signal) => {
          console.info(`[agent-chat-room] client follow opening session=${sessionId}`)
          return ctx.remote.agentChatRoom.follow(sessionId, signal)
        },
        subscribeReset: listener => ctx.on('connection/reset', listener),
      })
      sources.set(sessionId, source)
    }
    return source
  }
  const failure = (result: RemoteResult<unknown>): string | undefined => result.ok ? undefined : result.error.message
  const locale: HostObservable<string> = {
    getSnapshot: () => ctx.locale.getLocale().active,
    subscribe: listener => ctx.locale.subscribe(listener),
  }
  const panelFace = (sessionId: SessionId): ChatRoomPanelInjected => {
    const source = sourceOf(sessionId)
    return {
      hooks: { room: source.observable, locale },
      reconnect: source.reconnect,
      create: async label => failure(await ctx.remote.agentChatRoom.create(sessionId, label)),
      post: async content => failure(await ctx.remote.agentChatRoom.post(sessionId, content)),
      close: async () => failure(await ctx.remote.agentChatRoom.close(sessionId)),
    }
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => t('tab.title'),
    guide: [{
      id: 'open',
      order: 60,
      title: () => t('tab.title'),
      description: () => t('tab.description'),
      icon: IconUsersOutlineRegular,
    }],
  }), 'agent-chat-room: sidebar tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: panelFace,
  }, ChatRoomPanel))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'agent-chat-room',
    order: 15,
    locale: NS,
    inject: (): { open: () => void } => ({ open: () => { ctx.sidebarRight.openTab(TAB_KIND) } }),
  }, ChatRoomButton))
}

/**
 * Mount the generated Remote before its UI; disposal withdraws the UI first.
 * @param ctx - browser plugin lifetime.
 * @param contribution - generated chat room Remote definitions.
 * @returns the disposer of both contributions.
 */
export async function mountChatRoom(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.agentChatRoom', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight'], registerUi)
  try {
    await ui
    console.info('[agent-chat-room] client remote contribution mounted')
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}
