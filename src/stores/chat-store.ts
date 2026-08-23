import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import { type ChatConfig, type ChatMessage, chatService } from '@/services/chat-service';

import { useAsideStore } from './aside-store';

interface ChatReactionEvent {
  message_id: number;
  emoji: string;
  sender_id: string;
  reaction: { emoji: string; sender_id: string; ts: number } | null;
}

interface ChatTypingEvent {
  sender_id: string;
  sender_name: string;
  is_typing: boolean;
}

interface TypingUser {
  name: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingMessage {
  text: string;
  replyToId?: number;
  retries: number;
}

interface ChatStore {
  initialized: boolean;
  messages: ChatMessage[];
  config: ChatConfig;
  unread: number;
  typingUsers: Record<string, TypingUser>;
  init: () => Promise<void>;
  sendMessage: (text: string, replyToId?: number) => Promise<void>;
  sendFile: (filePath: string, text?: string, replyToId?: number) => Promise<void>;
  sendReaction: (messageId: number, emoji: string) => Promise<void>;
  sendTyping: (isTyping: boolean) => Promise<void>;
  toggleEnabled: (enabled: boolean) => Promise<void>;
  setPersistEnabled: (persistEnabled: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
  deleteMessage: (messageId: number) => Promise<void>;
  markRead: () => void;
}

const DEFAULT_CONFIG: ChatConfig = {
  enabled: true,
  persist_enabled: false,
  history_limit: 200,
};

let unlistenMessage: UnlistenFn | null = null;
let unlistenReaction: UnlistenFn | null = null;
let unlistenConfig: UnlistenFn | null = null;
let unlistenTyping: UnlistenFn | null = null;
let unlistenDeleted: UnlistenFn | null = null;
let unlistenRead: UnlistenFn | null = null;
let initPromise: Promise<void> | null = null;

const TYPING_TIMEOUT_MS = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const messageIndex = new Map<number, ChatMessage>();

function addToIndex(msg: ChatMessage) {
  messageIndex.set(msg.id, msg);
}

function mergeMessages(dbMessages: ChatMessage[], current: ChatMessage[]): ChatMessage[] {
  for (const m of dbMessages) {
    if (!messageIndex.has(m.id)) {
      addToIndex(m);
    }
  }
  for (const m of current) {
    if (!messageIndex.has(m.id)) {
      addToIndex(m);
    }
  }
  const merged = Array.from(messageIndex.values());
  merged.sort((a, b) => a.id - b.id);
  return merged;
}

const pendingQueue: PendingMessage[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function processRetryQueue(sendFn: (text: string, replyToId?: number) => Promise<void>) {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    const pending = [...pendingQueue];
    pendingQueue.length = 0;
    for (const item of pending) {
      if (item.retries >= MAX_RETRIES) {
        console.error(
          `[chat-store] message dropped after ${MAX_RETRIES} retries: "${item.text.slice(0, 30)}…"`
        );
        continue;
      }
      try {
        await sendFn(item.text, item.replyToId);
      } catch (err) {
        console.error(`[chat-store] retry failed (${item.retries + 1}/${MAX_RETRIES}):`, err);
        pendingQueue.push({ ...item, retries: item.retries + 1 });
      }
    }
    if (pendingQueue.length > 0) {
      processRetryQueue(sendFn);
    }
  }, RETRY_DELAY_MS);
}

export const useChatStore = create<ChatStore>((set, get) => ({
  initialized: false,
  messages: [],
  config: DEFAULT_CONFIG,
  unread: 0,
  typingUsers: {},

  init: async () => {
    if (get().initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        const [dbMessages, config] = await Promise.all([
          chatService.getMessages(),
          chatService.getConfig(),
        ]);

        const merged = mergeMessages(dbMessages, get().messages);
        set({ messages: merged, config, initialized: true });

        unlistenMessage?.();
        unlistenReaction?.();
        unlistenConfig?.();
        unlistenDeleted?.();
        unlistenRead?.();

        unlistenMessage = await listen<ChatMessage>('chat_message', ({ payload }) => {
          const chatTabActive = useAsideStore.getState().activeTab === 'chat';
          set((state) => {
            if (state.messages.some((m) => m.id === payload.id)) {
              return state;
            }
            addToIndex(payload);
            return {
              messages: [...state.messages, payload],
              unread:
                chatTabActive || payload.sender_id === 'operator' ? state.unread : state.unread + 1,
            };
          });
        });

        unlistenReaction = await listen<ChatReactionEvent>('chat_reaction', ({ payload }) => {
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === payload.message_id
                ? {
                    ...msg,
                    reactions: payload.reaction
                      ? applyReaction(msg.reactions ?? [], payload.reaction)
                      : (msg.reactions ?? []).filter(
                          (r) => !(r.emoji === payload.emoji && r.sender_id === payload.sender_id)
                        ),
                  }
                : msg
            ),
          }));
        });

        unlistenConfig = await listen<ChatConfig>('chat_config_changed', ({ payload }) => {
          set({ config: payload });
        });

        unlistenTyping?.();
        unlistenTyping = await listen<ChatTypingEvent>('chat_typing', ({ payload }) => {
          if (payload.sender_id === 'operator') return;

          set((state) => {
            const existing = state.typingUsers[payload.sender_id];
            if (existing) clearTimeout(existing.timeout);

            if (!payload.is_typing) {
              const next = { ...state.typingUsers };
              delete next[payload.sender_id];
              return { typingUsers: next };
            }

            const timeout = setTimeout(() => {
              set((s) => {
                const next = { ...s.typingUsers };
                delete next[payload.sender_id];
                return { typingUsers: next };
              });
            }, TYPING_TIMEOUT_MS);

            return {
              typingUsers: {
                ...state.typingUsers,
                [payload.sender_id]: { name: payload.sender_name, timeout },
              },
            };
          });
        });

        unlistenDeleted = await listen<{ message_id: number }>('chat_deleted', ({ payload }) => {
          messageIndex.delete(payload.message_id);
          set((state) => ({
            messages: state.messages.filter((m) => m.id !== payload.message_id),
          }));
        });

        unlistenRead = await listen<{ device_id: string; last_read_id: number }>(
          'chat_read',
          ({ payload }) => {
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.sender_id === 'operator' && msg.id <= payload.last_read_id
                  ? { ...msg, read: true }
                  : msg
              ),
            }));
          }
        );
      } catch (err) {
        console.error('[chat-store] init failed:', err);
        initPromise = null;
      }
    })();

    return initPromise;
  },

  sendMessage: async (text, replyToId) => {
    try {
      const msg = await chatService.sendMessage(text, replyToId);
      const safeMsg: ChatMessage = {
        ...msg,
        file: msg.file ?? null,
        reactions: msg.reactions ?? [],
      };
      const current = get().messages;
      if (!current.some((m) => m.id === safeMsg.id)) {
        addToIndex(safeMsg);
        set({ messages: [...current, safeMsg] });
      }
    } catch (err) {
      console.error('[chat-store] sendMessage failed, queuing retry:', err);
      pendingQueue.push({ text, replyToId, retries: 0 });
      processRetryQueue((t, r) => get().sendMessage(t, r));
      throw err;
    }
  },

  sendFile: async (filePath, text, replyToId) => {
    const msg = await chatService.sendFile(filePath, text, replyToId);
    const safeMsg: ChatMessage = {
      ...msg,
      file: msg.file ?? null,
      reactions: msg.reactions ?? [],
    };
    const current = get().messages;
    if (!current.some((m) => m.id === safeMsg.id)) {
      addToIndex(safeMsg);
      set({ messages: [...current, safeMsg] });
    }
  },

  sendReaction: async (messageId, emoji) => {
    const result = await chatService.sendReaction(messageId, emoji);
    const current = get().messages;
    set({
      messages: current.map((msg) =>
        msg.id === result.message_id
          ? {
              ...msg,
              reactions: result.reaction
                ? applyReaction(msg.reactions ?? [], result.reaction)
                : (msg.reactions ?? []).filter(
                    (r) => !(r.emoji === result.emoji && r.sender_id === result.sender_id)
                  ),
            }
          : msg
      ),
    });
  },

  sendTyping: async (isTyping) => {
    await chatService.sendTyping(isTyping);
  },

  toggleEnabled: async (enabled) => {
    const next = { ...get().config, enabled };
    await chatService.setConfig(next);
    set({ config: next });
  },

  setPersistEnabled: async (persistEnabled) => {
    const next = { ...get().config, persist_enabled: persistEnabled };
    await chatService.setConfig(next);
    set({ config: next });
  },

  clearHistory: async () => {
    await chatService.clearHistory();
    messageIndex.clear();
    set({ messages: [], unread: 0 });
  },

  deleteMessage: async (messageId) => {
    await chatService.deleteMessage(messageId);
    messageIndex.delete(messageId);
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    }));
  },

  markRead: () => {
    if (get().unread > 0) {
      set({ unread: 0 });
    }
  },
}));

function applyReaction(
  reactions: ChatMessage['reactions'],
  reaction: { emoji: string; sender_id: string; ts: number }
): ChatMessage['reactions'] {
  const withoutMine = reactions.filter(
    (r) => !(r.emoji === reaction.emoji && r.sender_id === reaction.sender_id)
  );
  return [...withoutMine, reaction];
}
