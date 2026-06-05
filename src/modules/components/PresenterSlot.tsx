import { readFile } from '@tauri-apps/plugin-fs';
import { useEffect, useState } from 'react';
import { useProfileStore } from '@/stores/profile-store';
import { useModuleStore } from '../store';
import type { PanelSpec } from '../types';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

interface BackgroundMedia {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
}

function useBackgroundBlobSrc(path?: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!path) { setSrc(undefined); return; }
    if (path.startsWith('http') || path.startsWith('#')) { setSrc(path); return; }

    let url: string;
    readFile(path)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes]));
        setSrc(url);
      })
      .catch(() => setSrc(undefined));

    return () => { if (url) URL.revokeObjectURL(url); };
  }, [path]);

  return src;
}

function PresenterBackground({ media }: { media: BackgroundMedia }) {
  const blobSrc = useBackgroundBlobSrc(media.type !== 'image' ? media.src : undefined);
  const src = media.type === 'image' ? media.src : blobSrc;

  if (!src) return null;

  if (media.type === 'video') {
    return <video src={src} autoPlay loop muted className="absolute inset-0 w-full h-full object-cover" />;
  }
  return <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />;
}

function PresenterDefaultBackground() {
  const { profiles, activeProfileId } = useProfileStore();
  const profileBg = profiles.find((p) => p.id === activeProfileId)?.defaultBackground?.src;
  const src = useBackgroundBlobSrc(profileBg);

  if (!src) return null;
  return <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />;
}

export function PresenterSlot() {
  const clearPresenter = useModuleStore((s) => s.clearPresenter);
  const spec = useModuleStore<PanelSpec | null>((s) => {
    if (!s.presenterViewId) return null;
    for (const specs of s.panels.values()) {
      const found = specs.find((p) => p.id === s.presenterViewId && p.slot === 'presenter.content');
      if (found) return found;
    }
    return null;
  });

  const moduleId = useModuleStore<string | null>((s) => {
    if (!s.presenterViewId) return null;
    for (const [modId, specs] of s.panels.entries()) {
      if (specs.some((p) => p.id === s.presenterViewId && p.slot === 'presenter.content')) {
        return modId;
      }
    }
    return null;
  });
  const props = useModuleStore((s) => s.presenterProps) as Record<string, unknown>;

  if (!spec || !moduleId) return null;

  const Component = spec.component;
  const background = props?.background as string | undefined;
  const bg = background === 'media' ? (props?.backgroundMedia as BackgroundMedia | undefined) : undefined;

  return (
    <div className="fixed inset-0 z-50">
      {background === 'default' && <PresenterDefaultBackground />}
      {bg && <PresenterBackground media={bg} />}
      <ModuleErrorBoundary moduleId={moduleId} panelId={spec.id}>
        <div data-module-scope={moduleId}>
          <Component {...props} onClose={clearPresenter} />
        </div>
      </ModuleErrorBoundary>
    </div>
  );
}
