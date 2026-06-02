import { useEffect, useRef } from 'react';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from '@/components/lyric-background-modal';
import { setBackgroundPickerOpener } from '../apis/ui';

function toAssetUrl(path: string): string {
  return `asset://localhost/${path.replace(/\\/g, '/')}`;
}

export function BackgroundPickerSlot() {
  const ref = useRef<LyricBackgroundModalRef>(null);

  useEffect(() => {
    setBackgroundPickerOpener((onSelect) => {
      ref.current?.open((bg) => {
        const src = bg.type !== 'image' ? toAssetUrl(bg.src) : bg.src;
        onSelect({ ...bg, src });
      });
    });
  }, []);

  return <LyricBackgroundModal ref={ref} />;
}
