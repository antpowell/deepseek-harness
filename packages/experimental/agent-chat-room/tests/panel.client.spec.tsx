// @vitest-environment jsdom
/** Visible room states and direct orchestrator actions. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRoomButton, type ChatRoomButtonProps } from '../src/client/ChatRoomButton.tsx'
import { ChatRoomPanel, type ChatRoomPanelProps } from '../src/client/ChatRoomPanel.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { ChatRoomStreamSnapshot } from '../src/client/source.ts'
import type { ChatRoomSnapshot } from '../src/types.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const room: ChatRoomSnapshot = {
  roomId: SessionId('root'),
  label: 'Release planning',
  members: [
    { sessionId: SessionId('root'), name: 'Head Orchestrator', role: 'orchestrator', joinedAt: 1 },
    { sessionId: SessionId('researcher'), name: 'Researcher', role: 'agent', joinedAt: 2 },
  ],
  messages: [{
    id: 'message-1',
    author: { sessionId: SessionId('researcher'), name: 'Researcher', role: 'agent' },
    content: 'The migration is ready.',
    postedAt: Date.UTC(2026, 10, 16, 12, 30),
  }],
  maxMembers: 16,
  maxMessageLength: 100,
}

function fixture(frame: ChatRoomStreamSnapshot = { frame: { room }, disconnected: false }) {
  const state = createSnapshotStore(frame)
  const locale = createSnapshotStore('en')
  const props = {
    useRoom: bindSnapshotSelector(state),
    useLocale: bindSnapshotSelector(locale),
    reconnect: vi.fn(),
    create: vi.fn(async (_label: string): Promise<string | undefined> => undefined),
    post: vi.fn(async (_content: string): Promise<string | undefined> => undefined),
    close: vi.fn(async () => undefined),
    t: makeTranslate(en),
  } satisfies ChatRoomPanelProps
  return {
    props,
    state,
    locale,
    publish(next: ChatRoomStreamSnapshot) { act(() => { state.set(next) }) },
  }
}

describe('ChatRoomPanel', () => {
  it('shows loading and disconnected states and retries an interrupted opening', () => {
    const f = fixture({ frame: null, disconnected: false })
    const view = render(<ChatRoomPanel {...f.props} />)
    expect(screen.getByRole('status').textContent).toContain(en.loading)
    f.publish({ frame: null, disconnected: true })
    expect(screen.getByRole('status').textContent).toContain(en.disconnected)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(f.props.reconnect).toHaveBeenCalledOnce()
    view.rerender(<ChatRoomPanel {...f.props} t={makeTranslate(zh)} />)
    expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy()
  })

  it('creates from the empty state and preserves the label when creation fails', async () => {
    const f = fixture({ frame: { room: null }, disconnected: false })
    render(<ChatRoomPanel {...f.props} />)
    expect(screen.getByRole('heading', { name: en['create.title'] })).toBeTruthy()
    const input = screen.getByRole('textbox', { name: en['create.label'] })
    fireEvent.change(input, { target: { value: 'Incident response' } })
    const pending = Promise.withResolvers<string | undefined>()
    f.props.create.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: en['create.action'] }))
    expect(f.props.create).toHaveBeenCalledWith('Incident response')
    expect(screen.getByRole('button', { name: en['create.pending'] }).hasAttribute('disabled')).toBe(true)
    expect(input.hasAttribute('disabled')).toBe(true)
    await act(async () => { pending.resolve('Room limit reached'); await pending.promise })
    expect(screen.getByRole('alert').textContent).toContain('Room limit reached')
    expect((input as HTMLInputElement).value).toBe('Incident response')

    fireEvent.click(screen.getByRole('button', { name: en['create.action'] }))
    await waitFor(() => { expect((input as HTMLInputElement).value).toBe('') })
    expect(f.props.create).toHaveBeenCalledTimes(2)
  })

  it('renders live membership and messages, posts trimmed drafts, and closes the room', async () => {
    const f = fixture()
    render(<ChatRoomPanel {...f.props} />)
    expect(screen.getByRole('heading', { name: room.label })).toBeTruthy()
    expect(screen.getByRole('region', { name: en['room.members'].replace('{count}', '2') }).textContent).toContain('Researcher')
    expect(screen.getByText('The migration is ready.')).toBeTruthy()

    const draft = screen.getByRole('textbox', { name: en['message.label'] })
    expect(screen.getByRole('button', { name: en['message.post'] }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(draft, { target: { value: '  Start the rollout.  ' } })
    fireEvent.click(screen.getByRole('button', { name: en['message.post'] }))
    await waitFor(() => { expect((draft as HTMLTextAreaElement).value).toBe('') })
    expect(f.props.post).toHaveBeenCalledWith('  Start the rollout.  ')

    fireEvent.click(screen.getByRole('button', { name: en['room.close'] }))
    await waitFor(() => { expect(f.props.close).toHaveBeenCalledOnce() })
    f.publish({ frame: { room: null }, disconnected: false })
    expect(screen.getByRole('heading', { name: en['create.title'] })).toBeTruthy()
  })

  it('keeps a failed post draft and reports pending and retry states without losing content', async () => {
    const f = fixture()
    render(<ChatRoomPanel {...f.props} />)
    const draft = screen.getByRole('textbox', { name: en['message.label'] })
    fireEvent.change(draft, { target: { value: 'Keep this draft' } })
    const pending = Promise.withResolvers<string | undefined>()
    f.props.post.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: en['message.post'] }))
    expect(screen.getByRole('button', { name: en['message.posting'] }).hasAttribute('disabled')).toBe(true)
    expect(draft.hasAttribute('disabled')).toBe(true)
    await act(async () => { pending.resolve('Agent unavailable'); await pending.promise })
    expect(screen.getByRole('alert').textContent).toContain('Agent unavailable')
    expect((draft as HTMLTextAreaElement).value).toBe('Keep this draft')

    f.publish({ frame: { room }, disconnected: true })
    expect(screen.getByText(en.disconnected)).toBeTruthy()
    expect(screen.getByText('The migration is ready.')).toBeTruthy()
  })
})

it('opens the room from a labeled composer button', () => {
  const open = vi.fn()
  const props = { open, t: makeTranslate(en) } satisfies ChatRoomButtonProps
  render(<ChatRoomButton {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.open }))
  expect(open).toHaveBeenCalledOnce()
})
