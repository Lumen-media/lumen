import { createRootRoute, Outlet } from '@tanstack/react-router';
import * as React from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { GlobalAlert } from '@/components/global-alert';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from '@/components/lyric-background-modal';
import { LyricModal } from '@/components/lyric-modal';
import { QuickShortcutsModal } from '@/components/quick-shortcuts-modal';
import { Toaster } from '@/components/ui/sonner';
import { useModules } from '@/hooks/use-modules';
import { useProfiles } from '@/hooks/use-profiles';
import { useSingleInstance } from '@/hooks/use-single-instance';
import { useTheme } from '@/hooks/use-theme';
import { DialogSlot } from '@/modules/components/DialogSlot';
import { setBackgroundPickerOpener } from '@/modules/apis/ui';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  useSingleInstance();
  useTheme();
  useProfiles();
  useModules();

  const bgModalRef = React.useRef<LyricBackgroundModalRef>(null);

  React.useEffect(() => {
    setBackgroundPickerOpener((onSelect) => {
      bgModalRef.current?.open((bg) => {
        const src = bg.type !== 'image' ? convertFileSrc(bg.src) : bg.src;
        onSelect({ ...bg, src });
      });
    });
  }, []);

  return (
    <React.Fragment>
      <Outlet />
      <Toaster />
      <GlobalAlert />
      <QuickShortcutsModal />
      <LyricModal />
      <DialogSlot />
      <LyricBackgroundModal ref={bgModalRef} />
    </React.Fragment>
  );
}
