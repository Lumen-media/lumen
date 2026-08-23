import { invoke } from '@tauri-apps/api/core';

export const MAX_MESSAGE_LENGTH = 4000;

export interface ChatFile {
  file_name: string;
  file_path: string;
  file_size: number;
}

export interface Reaction {
  emoji: string;
  sender_id: string;
  ts: number;
}

export interface ChatMessage {
  id: number;
  sender_id: string;
  sender_type: string;
  sender_name: string;
  text: string;
  ts: number;
  file: ChatFile | null;
  reactions: Reaction[];
  read?: boolean;
  reply_to?: {
    id: number;
    sender_name: string;
    text: string;
    file: ChatFile | null;
  } | null;
}

export interface ChatConfig {
  enabled: boolean;
  persist_enabled: boolean;
  history_limit: number;
  notification_mode: 'off' | 'toast' | 'os';
}

export interface ChatReactionResult {
  message_id: number;
  emoji: string;
  sender_id: string;
  reaction: Reaction | null;
}

class ChatService {
  async getMessages(limit?: number): Promise<ChatMessage[]> {
    return invoke<ChatMessage[]>('get_chat_messages', limit != null ? { limit } : {});
  }

  async sendMessage(text: string, replyToId?: number): Promise<ChatMessage> {
    return invoke<ChatMessage>('send_chat_message', { text, replyToId: replyToId ?? null });
  }

  async sendFile(filePath: string, text?: string, replyToId?: number): Promise<ChatMessage> {
    return invoke<ChatMessage>('send_chat_file', {
      filePath,
      text: text ?? null,
      replyToId: replyToId ?? null,
    });
  }

  async sendReaction(messageId: number, emoji: string): Promise<ChatReactionResult> {
    return invoke<ChatReactionResult>('send_chat_reaction', { messageId, emoji });
  }

  async getConfig(): Promise<ChatConfig> {
    return invoke<ChatConfig>('get_chat_config');
  }

  async setConfig(config: ChatConfig): Promise<void> {
    await invoke('set_chat_config', { config });
  }

  async clearHistory(): Promise<void> {
    await invoke('clear_chat_history');
  }

  async sendTyping(isTyping: boolean): Promise<void> {
    await invoke('send_chat_typing', { isTyping });
  }

  async deleteMessage(messageId: number): Promise<void> {
    await invoke('delete_chat_message', { messageId });
  }
}

export const chatService = new ChatService();
