/** Real cordis.yml Loader composition with live Agent, Session, and tools. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { afterEach, expect, it } from 'vitest'
import * as ChatRoom from '../src/index.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

it('loads through cordis.yml, exposes tools and durable room output, and unregisters on disposal', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-agent-chat-room-loader-'))
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-working-directory', WorkingDirectoryService],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-agent-chat-room', ChatRoom],
  ])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...modules.keys()].flatMap(name => [
    `- name: 'cordis:${name}'`,
    ...name === '@deepseek-ai/dsh-agent-loop' ? ['  config:', '    agents: []'] : [],
  ]).join('\n') + '\n')

  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  for (const [specifier, plugin] of modules) ctx.loader.builtins[specifier] = plugin
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()

  expect('default' in ChatRoom).toBe(false)
  expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining([
    'agent_chat_create', 'agent_chat_join', 'agent_chat_post', 'agent_chat_close',
  ]))
  const agent = await ctx.agentLoop.create(SessionId('chat-room-loader'), { provider: 'fixture', model: 'fixture' }, { cwd: root })
  const created = await executeToolFixture(ctx, {
    name: 'agent_chat_create', callId: ToolCallId('create'), arguments: { label: 'Release room' },
    agent, signal: new AbortController().signal,
  })
  expect(created.isError).not.toBe(true)
  expect(created.value).toEqual({ roomId: agent.id, label: 'Release room' })

  const controller = new AbortController()
  const stream = ctx.agentChatRooms.follow(agent, controller.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value).toMatchObject({ room: { label: 'Release room' } })
  const posted = await ctx.agentChatRooms.post(agent, 'Visible in the room panel')
  expect(posted.content).toBe('Visible in the room panel')
  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Broadcast from the orchestrator' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  // The session-event broadcast is asynchronous; wait for it to land in the room.
  const expectedMessages = ['Visible in the room panel', 'Broadcast from the orchestrator']
  let observed: string[] = []
  for (let attempt = 0; attempt < 300; attempt++) {
    observed = ctx.agentChatRooms.getRoom(agent.id)?.messages.map(item => item.content) ?? []
    if (observed.length >= expectedMessages.length) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(observed).toEqual(expectedMessages)
  const records = agent.session.snapshotEvents().flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:agent-chat-room/message' ? [record.data] : []
  })
  expect(records).toHaveLength(2)
  controller.abort()
  expect((await stream.next()).done).toBe(true)

  const entry = [...ctx.loader.entries()]
    .find(candidate => candidate.options.name === 'cordis:@deepseek-ai/dsh-agent-chat-room')
  expect(entry?.fiber).toBeDefined()
  await entry!.fiber!.dispose()
  expect(ctx.tools.schemas().some(tool => tool.name === 'agent_chat_create')).toBe(false)
  expect(ctx.get('agentChatRooms')).toBeUndefined()
})
