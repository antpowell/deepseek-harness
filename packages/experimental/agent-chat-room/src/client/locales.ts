/** Chat room copy owned by the locale dictionaries. */

/** Locale namespace of the chat room panel. */
export const NS = 'agentChatRoom'

/** English copy; its keys define {@link ChatRoomKey}. */
export const en = {
  'tab.title': 'Chat room',
  'tab.description': 'See agents coordinate in this Session’s shared room',
  'open': 'Chat room',
  'loading': 'Loading chat room…',
  'disconnected': 'The chat room connection was interrupted.',
  'retry': 'Retry',
  'create.title': 'Start a shared room',
  'create.description': 'Create a room for this Session, then ask agents to join with agent_chat_join.',
  'create.label': 'Room label (optional)',
  'create.placeholder': 'Agent Chat Room',
  'create.action': 'Create room',
  'create.pending': 'Creating…',
  'room.members': 'Members ({count})',
  'room.close': 'Close room',
  'room.closing': 'Closing…',
  'role.orchestrator': 'Orchestrator',
  'role.agent': 'Agent',
  'role.observer': 'Observer',
  'messages.title': 'Messages',
  'messages.empty': 'No messages yet. Ask the participating agents to discuss the task here.',
  'message.label': 'Message to the room',
  'message.placeholder': 'Write a message as Head Orchestrator…',
  'message.post': 'Post',
  'message.posting': 'Posting…',
  'action.failed': 'Chat room action failed: {message}',
} as const

/** Key of the chat room dictionaries. */
export type ChatRoomKey = keyof typeof en

/** Chinese copy with the same keys. */
export const zh: Record<ChatRoomKey, string> = {
  'tab.title': '聊天室',
  'tab.description': '查看智能体如何在此会话的共享房间中协作',
  'open': '聊天室',
  'loading': '正在加载聊天室……',
  'disconnected': '聊天室连接已中断。',
  'retry': '重试',
  'create.title': '创建共享房间',
  'create.description': '为此会话创建房间，然后让智能体通过 agent_chat_join 加入。',
  'create.label': '房间名称（可选）',
  'create.placeholder': '智能体聊天室',
  'create.action': '创建房间',
  'create.pending': '正在创建……',
  'room.members': '成员（{count}）',
  'room.close': '关闭房间',
  'room.closing': '正在关闭……',
  'role.orchestrator': '调度员',
  'role.agent': '智能体',
  'role.observer': '观察者',
  'messages.title': '消息',
  'messages.empty': '还没有消息。请让参与的智能体在此讨论任务。',
  'message.label': '发送到房间的消息',
  'message.placeholder': '以总调度员身份输入消息……',
  'message.post': '发送',
  'message.posting': '正在发送……',
  'action.failed': '聊天室操作失败：{message}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Chat room tab, composer button, and room actions. */
    agentChatRoom: ChatRoomKey
  }
}
