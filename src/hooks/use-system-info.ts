import { invoke } from '@tauri-apps/api/core';
import { arch, platform, version } from '@tauri-apps/plugin-os';
import { useEffect, useState } from 'react';

export interface SystemInfo {
  os: string;
  arch: string;
  memory: string;
  gpu: string;
}

interface SystemHardwareInfo {
  total_memory_gb: number;
  gpu_name: string;
}

function formatOs(p: string, v: string): string {
  const map: Record<string, string> = {
    macos: `macOS ${v}`,
    windows: `Windows ${v}`,
    linux: `Linux ${v}`,
    ios: `iOS ${v}`,
    android: `Android ${v}`,
  };
  return map[p] ?? `${p} ${v}`;
}

function formatArch(a: string): string {
  const map: Record<string, string> = {
    x86_64: 'x86_64',
    aarch64: 'Apple Silicon (arm64)',
    x86: 'x86 (32-bit)',
    arm: 'ARM (32-bit)',
  };
  return map[a] ?? a;
}

export function useSystemInfo(): SystemInfo {
  const [info, setInfo] = useState<SystemInfo>({
    os: '—',
    arch: '—',
    memory: '—',
    gpu: '—',
  });

  useEffect(() => {
    const os = formatOs(platform(), version());
    const architecture = formatArch(arch());

    setInfo((prev) => ({ ...prev, os, arch: architecture }));

    invoke<SystemHardwareInfo>('get_system_info')
      .then(({ total_memory_gb, gpu_name }) => {
        setInfo((prev) => ({
          ...prev,
          memory: `${total_memory_gb} GB`,
          gpu: gpu_name,
        }));
      })
      .catch(console.error);
  }, []);

  return info;
}
