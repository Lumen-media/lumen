import type { CommandSpec, CommandsAPI, Disposable } from '../types';

const registry = new Map<string, CommandSpec>();

export function createCommandsAPI(): CommandsAPI {
  return {
    add(spec: CommandSpec): Disposable {
      registry.set(spec.id, spec);
      return {
        dispose() {
          registry.delete(spec.id);
        },
      };
    },

    invoke(id: string, args?: unknown): unknown {
      const spec = registry.get(id);
      if (!spec) {
        console.warn(`[modules] command not found: ${id}`);
        return undefined;
      }
      return spec.run(args);
    },
  };
}

export function getCommandRegistry(): ReadonlyMap<string, CommandSpec> {
  return registry;
}
