/** Right-sidebar room view: membership, live messages, and orchestrator actions. */

import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconUsersOutlineRegular, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatRoomMessage } from '../types.ts'
import type { NS } from './locales.ts'
import type { ChatRoomStreamSnapshot } from './source.ts'
import css from './ChatRoomPanel.module.css'

/** Business face of one Session's chat room tab. */
export interface ChatRoomPanelInjected {
  /** Room stream and active locale, bound as `useRoom` and `useLocale`. */
  readonly hooks: {
    readonly room: HostObservable<ChatRoomStreamSnapshot>
    readonly locale: HostObservable<string>
  }
  /** Reopen an ended room stream. */
  readonly reconnect: () => void
  /** Create the room; resolves to a failure message or undefined on success. */
  readonly create: (label: string) => Promise<string | undefined>
  /** Post as Head Orchestrator; resolves to a failure message or undefined on success. */
  readonly post: (content: string) => Promise<string | undefined>
  /** Close the room; resolves to a failure message or undefined on success. */
  readonly close: () => Promise<string | undefined>
}

/** Full props of the chat room tab. */
export type ChatRoomPanelProps = InjectFace<ChatRoomPanelInjected> & PropsLocale<typeof NS>

type Pending = 'create' | 'post' | 'close' | null

const ROLE_KEY = {
  orchestrator: 'role.orchestrator',
  agent: 'role.agent',
  observer: 'role.observer',
} as const

/** Render the room and keep drafts intact when an action fails. */
export function ChatRoomPanel({ useRoom, useLocale, reconnect, create, post, close, t }: ChatRoomPanelProps): ReactNode {
  const snapshot = useRoom(current => current)
  const locale = useLocale(current => current)
  const [label, setLabel] = useState('')
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const room = snapshot.frame?.room ?? null
  const run = async (action: Exclude<Pending, null>, operation: () => Promise<string | undefined>): Promise<boolean> => {
    setPending(action)
    setFailure(null)
    try {
      const message = await operation()
      if (message !== undefined) {
        setFailure(message)
        return false
      }
      return true
    } finally {
      setPending(null)
    }
  }
  const createRoom = (event: FormEvent): void => {
    event.preventDefault()
    if (pending !== null) return
    void run('create', () => create(label)).then((created) => { if (created) setLabel('') })
  }
  const postMessage = (event: FormEvent): void => {
    event.preventDefault()
    if (pending !== null || draft.trim().length === 0) return
    void run('post', () => post(draft)).then((posted) => { if (posted) setDraft('') })
  }
  const closeRoom = (): void => {
    if (pending !== null) return
    void run('close', close)
  }
  const disconnected = snapshot.disconnected && (
    <div className={css.disconnected} role="status">
      <span>{t('disconnected')}</span>
      <Button size="sm" variant="outline" onClick={reconnect}>{t('retry')}</Button>
    </div>
  )
  const streamError = snapshot.error !== undefined && (
    <p className={css.streamError} role="alert">{snapshot.error}</p>
  )
  if (snapshot.frame === null) {
    if (snapshot.disconnected) {
      return (
        <div className={css.centered}>
          {disconnected}
          {streamError}
        </div>
      )
    }
    return (
      <div className={css.centered} role="status">
        <StateDot state="ongoing" />
        <span>{t('loading')}</span>
      </div>
    )
  }
  return (
    <div className={css.root} data-agent-chat-room-panel="" aria-busy={pending !== null}>
      {disconnected}
      {streamError}
      {failure !== null && <div className={css.failure} role="alert">{t('action.failed', { message: failure })}</div>}
      {room === null ? (
        <section className={css.empty}>
          <IconUsersOutlineRegular size={24} className={css.emptyIcon} />
          <h2 className={css.emptyTitle}>{t('create.title')}</h2>
          <p className={css.guidance}>{t('create.description')}</p>
          <form className={css.createForm} onSubmit={createRoom}>
            <Input
              aria-label={t('create.label')}
              placeholder={t('create.placeholder')}
              value={label}
              disabled={pending !== null}
              onChange={(event) => { setLabel(event.target.value) }}
            />
            <Button type="submit" variant="primary" disabled={pending !== null}>
              {t(pending === 'create' ? 'create.pending' : 'create.action')}
            </Button>
          </form>
        </section>
      ) : (
        <>
          <section className={css.roomHeader}>
            <div className={css.roomHeading}>
              <IconUsersOutlineRegular size={18} className={css.roomIcon} />
              <h2 className={css.roomTitle}>{room.label}</h2>
            </div>
            <Button size="sm" variant="ghost" disabled={pending !== null} onClick={closeRoom}>
              {t(pending === 'close' ? 'room.closing' : 'room.close')}
            </Button>
          </section>
          <section className={css.members} aria-label={t('room.members', { count: room.members.length })}>
            <h3 className={css.sectionTitle}>{t('room.members', { count: room.members.length })}</h3>
            <ul className={css.memberList}>
              {room.members.map(member => (
                <li className={css.member} key={member.sessionId}>
                  <span className={css.memberName}>{member.name}</span>
                  <span className={css.role}>{t(ROLE_KEY[member.role])}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className={css.messages}>
            <h3 className={css.sectionTitle}>{t('messages.title')}</h3>
            {room.messages.length === 0
              ? <p className={css.guidance}>{t('messages.empty')}</p>
              : (
                <ol className={css.messageList}>
                  {room.messages.map(message => (
                    <Message key={message.id} message={message} locale={locale} role={t(ROLE_KEY[message.author.role])} />
                  ))}
                </ol>
              )}
          </section>
          <form className={css.composer} onSubmit={postMessage}>
            <textarea
              className={css.textarea}
              aria-label={t('message.label')}
              placeholder={t('message.placeholder')}
              value={draft}
              maxLength={room.maxMessageLength}
              disabled={pending !== null}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <Button type="submit" variant="primary" disabled={pending !== null || draft.trim().length === 0}>
              {t(pending === 'post' ? 'message.posting' : 'message.post')}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}

function Message({ message, locale, role }: {
  readonly message: ChatRoomMessage
  readonly locale: string
  readonly role: string
}): ReactNode {
  const postedAt = new Date(message.postedAt)
  return (
    <li className={css.message}>
      <div className={css.messageHeader}>
        <span className={css.memberName}>{message.author.name}</span>
        <span className={css.role}>{role}</span>
        <time className={css.time} dateTime={postedAt.toISOString()}>
          {postedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <p className={css.content}>{message.content}</p>
    </li>
  )
}
