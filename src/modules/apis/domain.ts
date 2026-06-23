import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { thumbnailService } from '@/services/thumbnail-service';
import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { lyricService } from '@/services/lyric-service';
import { mediaDbService } from '@/services/media-db-service';
import { useModuleStore } from '../store';
import { usePlayerStore } from '@/stores/player-store';
import { useQueueEntriesStore } from '@/stores/queue-entries-store';
import type {
  LibraryHostAPI,
  LyricsHostAPI,
  MediaItem,
  MediaRef,
  MediaType as PublicMediaType,
  PlayerHostAPI,
  PresentationHostAPI,
  OverlayHostAPI,
  QueueHostAPI,
  ThemesHostAPI,
} from '../types';
import { globalBus } from './bus';
import { useProfileStore } from '@/stores/profile-store';

function stripExt(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

export function createLyricsHostAPI(): LyricsHostAPI {
  return {
    async list(query) {
      const term = query?.search?.trim();
      const hits = term
        ? await mediaDbService.search(term, { mediaType: 'lyrics', fullContent: true, limit: 100 })
        : await mediaDbService.listByType('lyrics', 200);
      return hits.map((h) => ({
        id: String(h.id),
        title: stripExt(h.name),
        artist: h.artist ?? undefined,
      }));
    },
    async get(id) {
      const numId = Number(id);
      if (!Number.isFinite(numId)) return null;
      const hit = await mediaDbService.getById(numId);
      if (!hit || hit.media_type !== 'lyrics') return null;
      const data = await lyricService.load(hit.path);
      return {
        id,
        title: data.metadata.name || stripExt(hit.name),
        artist: data.metadata.author || hit.artist || undefined,
        slides: data.slides.map((slide, index) => ({
          index,
          text: slide.lines.join('\n'),
        })),
      };
    },
    currentSlide() {
      return null;
    },
    advance() {
      globalBus.emit('lyrics:advance');
    },
    back() {
      globalBus.emit('lyrics:back');
    },
  };
}

export function createQueueHostAPI(): QueueHostAPI {
  return {
    items() {
      return [];
    },
    currentIndex() {
      return -1;
    },
    add(item, position) {
      globalBus.emit('queue:add', { item, position });
    },
    remove(id) {
      globalBus.emit('queue:remove', { id });
    },
    reorder(fromIndex, toIndex) {
      globalBus.emit('queue:reorder', { fromIndex, toIndex });
    },
    shuffle() {
      globalBus.emit('queue:shuffle');
    },
    markPlayed(id) {
      globalBus.emit('queue:markPlayed', { id });
    },
    state() {
      return { items: [], currentIndex: null };
    },
    onChange(handler) {
      return globalBus.on('queue:changed', handler);
    },
    next() {
      const result = useQueueEntriesStore.getState().advanceQueue(
        usePlayerStore.getState().currentFilePath
      );
      if (result.type === 'play') {
        void usePlayerStore.getState().loadFile(result.path);
      }
    },
    previous() {
      globalBus.emit('queue:previous');
    },
    goTo(index) {
      globalBus.emit('queue:goTo', { index });
    },
    registerTrigger(spec) {
      const dispose = useModuleStore.getState().registerQueueTrigger(spec);
      return { dispose };
    },
  };
}

export function createLibraryHostAPI(): LibraryHostAPI {
  return {
    async list(type, query) {
      const term = query?.trim();
      const hits = term
        ? await mediaDbService.search(term, { mediaType: type, fullContent: false, limit: 100 })
        : type
          ? await mediaDbService.listByType(type, 200)
          : [];
      return hits.map<MediaRef>((h) => ({
        id: String(h.id),
        path: h.path,
        name: h.name,
        type: h.media_type as PublicMediaType,
      }));
    },
    async get(id) {
      const numId = Number(id);
      if (!Number.isFinite(numId)) return null;
      const hit = await mediaDbService.getById(numId);
      if (!hit) return null;
      return {
        id,
        path: hit.path,
        name: hit.name,
        type: hit.media_type as PublicMediaType,
        duration: hit.duration ?? undefined,
        size: 0,
        modifiedAt: new Date(hit.modified_at).toISOString(),
      } satisfies MediaItem;
    },
    async metadata(_path) {
      return {};
    },
    async thumbnail(_path, _size) {
      return '';
    },
  };
}

export function createPlayerHostAPI(): PlayerHostAPI {
  return {
    current() {
      return null;
    },
    state() {
      return 'idle';
    },
    play(track) {
      globalBus.emit('player:play', { track });
    },
    pause() {
      globalBus.emit('player:pause');
    },
    seek(seconds) {
      globalBus.emit('player:seek', { seconds });
    },
    volume(value) {
      if (value !== undefined) {
        globalBus.emit('player:volume', { value });
      }
      return 1;
    },
    next() {
      globalBus.emit('player:next');
    },
    prev() {
      globalBus.emit('player:prev');
    },
  };
}

listen('module:presenter-window-closed', () => {
  useModuleStore.getState().clearPresenter();
  globalBus.emit('presentation:clear');
}).catch(() => {});

listen('module:overlay-window-closed', () => {
  overlayViewId = null;
  overlayProps = undefined;
  globalBus.emit('overlay:clear');
}).catch(() => {});

listen('module:overlay-ready', () => {
  if (!overlayViewId) return;
  emit('module:overlay-project', { viewId: overlayViewId, props: overlayProps }).catch(() => {});
}).catch(() => {});

let overlayViewId: string | null = null;
let overlayProps: unknown;

async function ensureMediaWindow(): Promise<{ created: boolean }> {
  let win = await WebviewWindow.getByLabel('media-window').catch(() => null);

  if (!win) {
    await invoke('create_window', { label: 'media-window', title: 'Media Player' }).catch(() => {});

    await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 6000);
      listen('module:presenter-ready', () => {
        clearTimeout(fallback);
        resolve();
      }).catch(() => {});
    });

    win = await WebviewWindow.getByLabel('media-window').catch(() => null);
    return { created: true };
  }

  const visible = await win.isVisible().catch(() => false);
  if (!visible) await win.show().catch(() => {});
  return { created: false };
}

async function ensureOverlayWindow(): Promise<{ created: boolean }> {
  let win = await WebviewWindow.getByLabel('module-overlay-window').catch(() => null);

  if (!win) {
    await invoke('create_window', {
      label: 'module-overlay-window',
      title: 'Module Overlay',
      route: '/module-overlay-window',
      fullscreen: false,
      decorations: true,
      width: 960,
      height: 540,
    }).catch(() => {});

    await new Promise<void>((resolve) => {
      const fallback = setTimeout(resolve, 6000);
      listen('module:overlay-ready', () => {
        clearTimeout(fallback);
        resolve();
      }).catch(() => {});
    });

    win = await WebviewWindow.getByLabel('module-overlay-window').catch(() => null);
    if (win) await win.show().catch(() => {});
    return { created: true };
  }

  const visible = await win.isVisible().catch(() => false);
  if (!visible) await win.show().catch(() => {});
  return { created: false };
}
export function createPresentationHostAPI(): PresentationHostAPI {
  let openedByModule = false;

  return {
    state() {
      return useModuleStore.getState().presenterViewId ? 'live' : 'idle';
    },
    onStateChange(handler) {
      const onProject = globalBus.on('presentation:project', () => handler('live'));
      const onClear = globalBus.on('presentation:clear', () => handler('idle'));
      return { dispose() { onProject.dispose(); onClear.dispose(); } };
    },
    project(viewId, props) {
      const isFirstProject = useModuleStore.getState().presenterViewId === null;
      useModuleStore.getState().projectPanel(viewId, props);
      globalBus.emit('presentation:project', { viewId, props });
      ensureMediaWindow()
        .then(({ created }) => {
          if (isFirstProject && created) openedByModule = true;
          return emit('module:presenter-project', { viewId, props });
        })
        .catch(() => {});
    },
    clear() {
      useModuleStore.getState().clearPresenter();
      globalBus.emit('presentation:clear');
      emit('module:presenter-clear').catch(() => {});
      if (openedByModule) {
        openedByModule = false;
        WebviewWindow.getByLabel('media-window')
          .then((w) => w?.close())
          .catch(() => {});
      }
    },
    isWindowOpen() {
      return useModuleStore.getState().presenterViewId !== null;
    },
  };
}

export function createOverlayHostAPI(): OverlayHostAPI {
  return {
    state() {
      return overlayViewId ? 'live' : 'idle';
    },
    onStateChange(handler) {
      const onProject = globalBus.on('overlay:project', () => handler('live'));
      const onClear = globalBus.on('overlay:clear', () => handler('idle'));
      return { dispose() { onProject.dispose(); onClear.dispose(); } };
    },
    project(viewId, props) {
      overlayViewId = viewId;
      overlayProps = props;
      globalBus.emit('overlay:project', { viewId, props });
      ensureOverlayWindow()
        .then(() => emit('module:overlay-project', { viewId, props }))
        .catch(() => {});
    },
    clear() {
      overlayViewId = null;
      overlayProps = undefined;
      globalBus.emit('overlay:clear');
      emit('module:overlay-clear').catch(() => {});
      WebviewWindow.getByLabel('module-overlay-window')
        .then((window) => window?.close())
        .catch(() => {});
    },
    isWindowOpen() {
      return overlayViewId !== null;
    },
  };
}
export function createThemesHostAPI(): ThemesHostAPI {
  return {
    current() {
      return { id: 'default', name: 'Default', colorMode: 'dark', accentId: 'cyan' };
    },
    list() {
      return [{ id: 'default', name: 'Default', colorMode: 'dark', accentId: 'cyan' }];
    },
    apply(id) {
      globalBus.emit('themes:apply', { id });
    },
    defaultBackground() {
      const { profiles, activeProfileId } = useProfileStore.getState();
      const profile = profiles.find((p) => p.id === activeProfileId);
      return profile?.defaultBackground ?? null;
    },
    onDefaultBackgroundChange(handler) {
      let lastSrc: string | null | undefined = undefined;

      const fire = (bg: { src: string; type: 'theme' | 'image' | 'video'; name: string } | null) => {
        const src = bg?.src ?? null;
        if (!src || src.startsWith('blob:') || src.startsWith('http') || src.startsWith('data:')) {
          handler(bg);
          return;
        }
        Promise.all([
          readFile(src).then((bytes) => URL.createObjectURL(new Blob([bytes]))),
          thumbnailService.getThumbnail(src, 200).catch(() => null),
        ])
          .then(([blobUrl, thumb]) => handler({ ...bg!, src: blobUrl, ...(thumb ? { thumb } : {}) }))
          .catch(() => handler(bg));
      };

      const unsub = useProfileStore.subscribe((state) => {
        const profile = state.profiles.find((p) => p.id === state.activeProfileId);
        const bg = profile?.defaultBackground ?? null;
        const src = bg?.src ?? null;
        if (src === lastSrc) return;
        lastSrc = src;
        fire(bg);
      });

      const { profiles, activeProfileId } = useProfileStore.getState();
      const profile = profiles.find((p) => p.id === activeProfileId);
      const current = profile?.defaultBackground ?? null;
      if (current?.src) {
        lastSrc = current.src;
        fire(current);
      }

      return { dispose: unsub };
    },
  };
}
