import { useCommandStore } from '@/stores/command-store';
import type { CommandSpec, CommandsAPI, Disposable } from '../types';

export function createCommandsAPI(): CommandsAPI {
  return {
    add(spec: CommandSpec): Disposable {
      useCommandStore.getState()._register(spec);
      return {
        dispose() {
          useCommandStore.getState()._unregister(spec.id);
        },
      };
    },

    invoke(id: string, args?: unknown): unknown {
      const spec = useCommandStore.getState().commands.find((c) => c.id === id);
      if (!spec) {
        console.warn(`[modules] command not found: ${id}`);
        return undefined;
      }
      return spec.run?.(args);
    },
  };
}

export function getCommandRegistry(): readonly CommandSpec[] {
  return useCommandStore.getState().commands;
}
