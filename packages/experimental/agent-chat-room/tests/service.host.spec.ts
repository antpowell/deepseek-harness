/** Room membership, durable publication, peer delivery, and stream lifetime. */

import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentChatRoomService } from '../src/service.ts'
import type { AgentChatRoomMessageRecord, ChatRoomFrame } from '../src/types.ts'

// The durable write goes through appendPluginRecord -> Session#appendRecord, a
// private seam no instance spy can reach; intercept the module export instead.
const durable = vi.hoisted(() => ({ spy: undefined as unknown as ReturnType<typeof vi.fn>, fail: false }))
vi.mock('@deepseek-ai/dsh-session', async () => {
  const actual = await vi.importActual<typeof import('@deepseek-ai/dsh-session')>('@deepseek-ai/dsh-session')
  durable.spy = vi.fn((session: unknown, type: string, data: unknown) => {
    if (durable.fail) throw new Error('storage full')
    return actual.appendPluginRecord(session as never, type as never, data as never)
  })
  return { ...actual, appendPluginRecord: durable.spy }
})

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
  durable.fail = false
  if (durable.spy !== undefined) durable.spy.mockClear()
})

function fixture() {
  const ctx = context = new Context()
  const live = new Map<SessionId, Agent>()
  const agent = (id: string): Agent => {
    const session = Session.create(SessionId(id))
    const value = { id: session.id, session } as Agent
    live.set(value.id, value)
    return value
  }
  ctx.provide('agents', { get: (id: SessionId) => live.get(id) } as AgentRegistry)
  const sendMessage = vi.fn<SubagentRuntime['sendMessage']>(async () => MessageId('delivery'))
  const runtime: Pick<SubagentRuntime, 'sendMessage'> = { sendMessage }
  const service = new AgentChatRoomService(ctx, runtime as SubagentRuntime, {
    maxMembers: 3,
    maxMessageLength: 40,
  })
  return { ctx, service, agent, sendMessage, live }
}

async function next(iterator: AsyncIterator<ChatRoomFrame>): Promise<ChatRoomFrame> {
  const result = await iterator.next()
  if (result.done === true) throw new Error('room stream ended before its next frame')
  return result.value
}

function records(agent: Agent): AgentChatRoomMessageRecord[] {
  return agent.session.snapshotEvents().flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:agent-chat-room/message'
      ? [record.data as AgentChatRoomMessageRecord]
      : []
  })
}

describe('AgentChatRoomService', () => {
  it('streams the initial absence, creation, membership, closure, and abortion', async () => {
    const f = fixture()
    const orchestrator = f.agent('orchestrator')
    const member = f.agent('member')
    const controller = new AbortController()
    const stream = f.service.follow(orchestrator, controller.signal)[Symbol.asyncIterator]()
    expect(await next(stream)).toEqual({ room: null })

    f.service.createRoom(orchestrator, '  Release planning  ')
    expect((await next(stream)).room).toMatchObject({
      roomId: orchestrator.id,
      label: 'Release planning',
      maxMembers: 3,
      maxMessageLength: 40,
      members: [{ sessionId: orchestrator.id, name: 'Head Orchestrator', role: 'orchestrator' }],
    })
    expect(() => f.service.createRoom(orchestrator, 'duplicate')).toThrow('already exists')

    f.service.joinRoom(orchestrator.id, member, ' Researcher ')
    expect((await next(stream)).room?.members).toMatchObject([
      { sessionId: orchestrator.id, role: 'orchestrator' },
      { sessionId: member.id, name: 'Researcher', role: 'agent' },
    ])
    f.service.joinRoom(orchestrator.id, member, 'ignored duplicate')
    expect(f.service.roomOf(member.id)?.members.get(member.id)?.name).toBe('Researcher')

    f.service.closeRoom(orchestrator.id)
    f.service.closeRoom(orchestrator.id)
    expect(await next(stream)).toEqual({ room: null })
    expect(f.service.listRooms()).toEqual([])
    expect(() => f.service.joinRoom(orchestrator.id, member, 'late')).toThrow('does not exist')

    controller.abort()
    expect((await stream.next()).done).toBe(true)
    expect(await stream.return?.()).toMatchObject({ done: true })
  })

  it('commits every post before publishing it and forwards only to other live members', async () => {
    const f = fixture()
    const orchestrator = f.agent('orchestrator')
    const researcher = f.agent('researcher')
    const observer = f.agent('observer')
    const offline = f.agent('offline')
    f.service.createRoom(orchestrator, 'Release')
    f.service.joinRoom(orchestrator.id, researcher, 'Researcher')
    f.service.joinRoom(orchestrator.id, observer, 'Observer', 'observer')
    f.service.joinRoom(orchestrator.id, offline, 'Offline')
    f.live.delete(offline.id)

    const stream = f.service.follow(orchestrator, new AbortController().signal)[Symbol.asyncIterator]()
    expect((await next(stream)).room?.messages).toEqual([])
    const message = await f.service.postMessage(orchestrator.id, researcher.id, '  Ship Monday.  ')
    expect(message.content).toBe('Ship Monday.')
    expect(durable.spy).toHaveBeenCalledTimes(1)
    expect(records(orchestrator)).toEqual([{ roomId: orchestrator.id, label: 'Release', message }])
    expect((await next(stream)).room?.messages).toEqual([message])
    expect(f.sendMessage.mock.calls.map(call => call[1])).toEqual([orchestrator.id, observer.id])
    for (const call of f.sendMessage.mock.calls) {
      expect(call[0]).toBe(researcher)
      expect(call[2]).toEqual([{ type: 'text', text: '[Release] Researcher: Ship Monday.' }])
    }

    const posted = await f.service.post(orchestrator, 'Proceed.')
    expect(posted.author.role).toBe('orchestrator')
    expect(records(orchestrator).map(record => record.message.content)).toEqual(['Ship Monday.', 'Proceed.'])
    expect(f.service.roomOf(researcher.id)?.messages).toHaveLength(2)
    await stream.return?.()
  })

  it('keeps failed durable appends and invalid posts out of the published room', async () => {
    const f = fixture()
    const orchestrator = f.agent('orchestrator')
    const outsider = f.agent('outsider')
    f.service.createRoom(orchestrator, 'Release')
    await expect(f.service.postMessage(orchestrator.id, outsider.id, 'not a member')).rejects.toThrow('not a member')
    await expect(f.service.postMessage(orchestrator.id, orchestrator.id, '  ')).rejects.toThrow('cannot be empty')
    await expect(f.service.postMessage(orchestrator.id, orchestrator.id, 'x'.repeat(41))).rejects.toThrow('exceeds 40')
    expect(f.service.getRoom(orchestrator.id)?.messages).toEqual([])

    durable.fail = true
    await expect(f.service.postMessage(orchestrator.id, orchestrator.id, 'not committed')).rejects.toThrow('storage full')
    expect(f.service.getRoom(orchestrator.id)?.messages).toEqual([])
    expect(records(orchestrator)).toEqual([])
  })

  it('enforces the configured member limit and contains peer-delivery failures', async () => {
    const f = fixture()
    const orchestrator = f.agent('orchestrator')
    const first = f.agent('first')
    const second = f.agent('second')
    const third = f.agent('third')
    f.service.createRoom(orchestrator, '')
    expect(f.service.getRoom(orchestrator.id)?.label).toBe('Agent Chat Room')
    f.service.joinRoom(orchestrator.id, first, '')
    f.service.joinRoom(orchestrator.id, second, 'Second')
    expect(f.service.getRoom(orchestrator.id)?.members.get(first.id)?.name).toBe('agent-first')
    expect(() => f.service.joinRoom(orchestrator.id, third, 'Third')).toThrow('full (max 3)')

    f.sendMessage.mockRejectedValueOnce(new Error('offline inbox'))
    const warn = vi.spyOn(f.ctx.logger, 'warn').mockImplementation(() => {})
    await expect(f.service.postMessage(orchestrator.id, first.id, 'Hello')).resolves.toMatchObject({ content: 'Hello' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline inbox'))
    expect(f.service.getRoom(orchestrator.id)?.messages).toHaveLength(1)
  })
})
