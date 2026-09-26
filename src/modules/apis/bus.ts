import type { BusAPI, Disposable } from '../types';

type Handler = (payload: unknown) => void;

const subscribers = new Map<string, Set<Handler>>();

function emit<T = unknown>(topic: string, payload?: T): void {
  const handlers = subscribers.get(topic);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload as unknown);
    } catch (err) {
      console.error(`[bus] handler error on topic "${topic}":`, err);
    }
  }
}

function on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable {
  if (!subscribers.has(topic)) {
    subscribers.set(topic, new Set());
  }
  subscribers.get(topic)!.add(handler as Handler);
  return {
    dispose() {
      subscribers.get(topic)?.delete(handler as Handler);
    },
  };
}

export const globalBus: BusAPI = { emit, on };

/** Module-scoped event bus. Topics are prefixed with the calling module id. */
export function createBusAPI(): BusAPI {
  return globalBus;
}

/** Alias factory for {@link createBusAPI}; backs the `host.events` property. */
export function createEventsAPI(): BusAPI {
  const localSubscribers = new Map<string, Set<Handler>>();

  return {
    emit<T = unknown>(topic: string, payload?: T): void {
      const handlers = localSubscribers.get(topic);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(payload as unknown);
        } catch (err) {
          console.error(`[events] handler error on topic "${topic}":`, err);
        }
      }
    },

    on<T = unknown>(topic: string, handler: (payload: T) => void): Disposable {
      if (!localSubscribers.has(topic)) {
        localSubscribers.set(topic, new Set());
      }
      localSubscribers.get(topic)!.add(handler as Handler);
      return {
        dispose() {
          localSubscribers.get(topic)?.delete(handler as Handler);
        },
      };
    },
  };
}
