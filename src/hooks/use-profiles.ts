import { useEffect } from 'react';
import { useProfileStore } from '@/stores/profile-store';

export function useProfiles() {
  const init = useProfileStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
}
