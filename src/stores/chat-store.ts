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

interface ChatStore {
  initialized: boolean;
  messages: ChatMessage[];
  config: ChatConfig;
  unread: number;
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  sendFile: (filePath: string, text?: string) => Promise<void>;
  sendReaction: (messageId: number, emoji: string) => Promise<void>;
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

export const useChatStore = create<ChatStore>((set, get) => ({
  initialized: false,
  messages: [],
  config: DEFAULT_CONFIG,
  unread: 0,

  init: async () => {
    if (get().initialized) {
      return;
    }

    const [messages, config] = await Promise.all([
      chatService.getMessages(),
      chatService.getConfig(),
    ]);

    set({ messages, config, initialized: true });

    unlistenMessage?.();
    unlistenReaction?.();
    unlistenConfig?.();

    unlistenMessage = await listen<ChatMessage>('chat_message', ({ payload }) => {
      const chatTabActive = useAsideStore.getState().activeTab === 'chat';
      set((state) => ({
        messages: [...state.messages, payload],
        unread:
          chatTabActive || payload.sender_id === 'operator'
            ? state.unread
            : state.unread + 1,
      }));
    });

    unlistenReaction = await listen<ChatReactionEvent>('chat_reaction', ({ payload }) => {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === payload.message_id
            ? {
                ...msg,
                reactions: payload.reaction
                  ? applyReaction(msg.reactions, payload.reaction)
                  : msg.reactions.filter(
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
  },

  sendMessage: async (text) => {
    await chatService.sendMessage(text);
  },

  sendFile: async (filePath, text) => {
    await chatService.sendFile(filePath, text);
  },

  sendReaction: async (messageId, emoji) => {
    await chatService.sendReaction(messageId, emoji);
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