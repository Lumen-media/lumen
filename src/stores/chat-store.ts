import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';

import { chatService, type ChatConfig, type ChatMessage } from '@/services/chat-service';

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

interface ChatStore {
  initialized: boolean;
  messages: ChatMessage[];
  config: ChatConfig;
  unread: number;
  typingUsers: Record<string, TypingUser>;
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  sendFile: (filePath: string, text?: string) => Promise<void>;
  sendReaction: (messageId: number, emoji: string) => Promise<void>;
  sendTyping: (isTyping: boolean) => Promise<void>;
  toggleEnabled: (enabled: boolean) => Promise<void>;
  setPersistEnabled: (persistEnabled: boolean) => Promise<void>;
  clearHistory: () => Promise<void>;
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

const TYPING_TIMEOUT_MS = 120_000; // 2 minutes

export const useChatStore = create<ChatStore>((set, get) => ({
  initialized: false,
  messages: [],
  config: DEFAULT_CONFIG,
  unread: 0,
  typingUsers: {},

  init: async () => {
    if (get().initialized) {
      return;
    }

    set({ initialized: true });

    const [dbMessages, config] = await Promise.all([
      chatService.getMessages(),
      chatService.getConfig(),
    ]);

    const current = get().messages;
    const currentIds = new Set(current.map((m) => m.id));
    const merged = [...dbMessages.filter((m) => !currentIds.has(m.id)), ...current];
    merged.sort((a, b) => a.ts - b.ts);
    set({ messages: merged, config });

    unlistenMessage?.();
    unlistenReaction?.();
    unlistenConfig?.();

    unlistenMessage = await listen<ChatMessage>('chat_message', ({ payload }) => {
      const chatTabActive = useAsideStore.getState().activeTab === 'chat';
      set((state) => {
        if (state.messages.some((m) => m.id === payload.id)) {
          return state;
        }
        return {
          messages: [...state.messages, payload],
          unread:
            chatTabActive || payload.sender_id === 'operator'
              ? state.unread
              : state.unread + 1,
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
                      (r) =>
                        !(r.emoji === payload.emoji && r.sender_id === payload.sender_id)
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
  },

  sendMessage: async (text) => {
    const msg = await chatService.sendMessage(text);
    const safeMsg: ChatMessage = {
      ...msg,
      file: msg.file ?? null,
      reactions: msg.reactions ?? [],
    };
    const current = get().messages;
    if (!current.some((m) => m.id === safeMsg.id)) {
      set({ messages: [...current, safeMsg] });
    }
  },

  sendFile: async (filePath, text) => {
    const msg = await chatService.sendFile(filePath, text);
    const safeMsg: ChatMessage = {
      ...msg,
      file: msg.file ?? null,
      reactions: msg.reactions ?? [],
    };
    const current = get().messages;
    if (!current.some((m) => m.id === safeMsg.id)) {
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
    set({ messages: [], unread: 0 });
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