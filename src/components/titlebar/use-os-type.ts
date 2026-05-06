import { platform } from '@tauri-apps/plugin-os';
import { useMemo } from 'react';

export type DesktopOsType = 'linux' | 'macos' | 'windows';

export function useOsType(): DesktopOsType {
  return useMemo(() => {
    const currentPlatform = platform();

    if (currentPlatform === 'macos' || currentPlatform === 'linux') {
      return currentPlatform;
    }

    return 'windows';
  }, []);
}
