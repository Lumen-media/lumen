// Copyright 2026 Gabriel Santos
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 — see LICENSE for the full text.
// If you modify this file, you must carry a prominent notice stating that you
// changed it (LICENSE section 4(b)).

/**
 * Typed wrapper around `invoke()`.
 *
 * Use it instead of importing `invoke` from `@tauri-apps/api/core` so the
 * command name, its argument names and its payload are checked against
 * {@link CommandMap}.
 *
 * ```ts
 * import { ipc } from '@/lib/ipc';
 *
 * const devices = await ipc('get_devices');
 * await ipc('toggle_device', { deviceId, isActive });
 * ```
 *
 * Errors reject with whatever the Rust command returned (usually a `string`)
 * or a transport error; callers keep deciding how to surface them.
 */

import { invoke } from '@tauri-apps/api/core';
import type { CommandArgs, CommandMap, CommandName, CommandResult, NoArgs } from './contract';

export type * from './contract';

type IpcArgs<K extends CommandName> =
  CommandArgs<K> extends NoArgs ? [args?: NoArgs] : [args: CommandArgs<K>];

/**
 * Invokes the Tauri command `K`.
 *
 * Commands whose Rust signature only declares injected state (`State`,
 * `AppHandle`) take no arguments and may be called as `ipc('queue_load')`.
 */
export function ipc<K extends CommandName>(
  command: K,
  ...args: IpcArgs<K>
): Promise<CommandResult<K>> {
  return invoke<CommandResult<K>>(command, args[0] as Record<string, unknown> | undefined);
}

export type { CommandMap };
