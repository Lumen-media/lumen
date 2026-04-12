import { useCallback, useEffect, useState } from 'react';
import { type AppConfig, loadConfig, saveConfigKey } from '@/services/config';

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  const update = useCallback(async <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    await saveConfigKey(key, value);
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  return { config, update };
}
