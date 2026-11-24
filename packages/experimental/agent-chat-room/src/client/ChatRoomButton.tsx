/** Composer entry that opens the chat room sidebar tab. */

import type { ReactNode } from 'react'
import { Button, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './ChatRoomButton.module.css'

/** Actions injected into the composer entry. */
export interface ChatRoomButtonInjected {
  /** Open or reveal this Session's chat room tab. */
  readonly open: () => void
}

/** Full props of the composer entry. */
export type ChatRoomButtonProps = InjectFace<ChatRoomButtonInjected> & PropsLocale<typeof NS>

/** Render the labeled chat room entry above the conversation composer. */
export function ChatRoomButton({ open, t }: ChatRoomButtonProps): ReactNode {
  return (
    <div className={css.dock}>
      <Button
        size="sm"
        variant="outline"
        icon={<IconUsersOutlineRegular size={16} />}
        aria-label={t('open')}
        data-agent-chat-room-open=""
        onClick={open}
      >
        {t('open')}
      </Button>
    </div>
  )
}
