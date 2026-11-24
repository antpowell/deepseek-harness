/** Browser entry point for the visible agent chat room. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import chatRoomRemote from '@deepseek-ai/dsh-agent-chat-room/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { mountChatRoom } from './mount.ts'

export const inject = ['remote', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

/** Mount the room stream, sidebar tab, and composer button. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountChatRoom(ctx, chatRoomRemote)
}
