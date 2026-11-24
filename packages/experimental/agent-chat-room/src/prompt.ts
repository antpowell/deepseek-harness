/**
 * System prompt contribution that tells the orchestrator agent about the chat room.
 */

import type { Context } from '@deepseek-ai/cordis'

export function installOrchestratorPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'agent-chat-room-orchestrator',
    order: 55,
    text:
      'You may create an agent chat room with `agent_chat_create` and invite subagents with '
      + '`agent_chat_join`. In the room, subagents use `agent_chat_post` to discuss solutions. '
      + 'The user is the Head Orchestrator: their chat messages are automatically broadcast to '
      + 'all room members. You do not need to repeat the user\'s instructions to the room.',
  })
}
