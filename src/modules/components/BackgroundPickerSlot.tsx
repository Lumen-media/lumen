import { useEffect, useRef } from 'react';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from '@/components/lyric-background-modal';
import { setBackgroundPickerOpener } from '../apis/ui';

export function BackgroundPickerSlot() {
  const ref = useRef<LyricBackgroundModalRef>(null);

  useEffect(() => {
    setBackgroundPickerOpener((onSelect) => {
      ref.current?.open((bg) => onSelect(bg));
    });
  }, []);

  return <LyricBackgroundModal ref={ref} />;
}
