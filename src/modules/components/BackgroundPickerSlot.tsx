import { useEffect, useRef } from 'react';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from '@/components/lyric-background-modal';
import { mediaDbService } from '@/services/media-db-service';
import { setBackgroundPickerOpener } from '../apis/ui';

export function BackgroundPickerSlot() {
  const ref = useRef<LyricBackgroundModalRef>(null);

  useEffect(() => {
    setBackgroundPickerOpener((onSelect) => {
      ref.current?.open((bg) => {
        if (bg.type !== 'theme') {
          onSelect(bg);
          return;
        }

        mediaDbService
          .listThemes()
          .then((themes) => {
            const theme = themes.find((item) => item.path === bg.src);
            if (theme?.id === undefined) {
              onSelect(bg);
              return;
            }
            onSelect({ ...bg, src: `http://lumen-module.localhost/__theme/id/${theme.id}` });
          })
          .catch(() => onSelect(bg));
      });
    });
  }, []);

  return <LyricBackgroundModal ref={ref} />;
}
