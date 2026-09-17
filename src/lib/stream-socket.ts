export const STREAM_WS_URL = 'ws://localhost:8080';

export function createStreamSocket(): WebSocket {
  return new WebSocket(STREAM_WS_URL);
}