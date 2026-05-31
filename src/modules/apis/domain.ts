import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { lyricService } from '@/services/lyric-service';
import { mediaDbService } from '@/services/media-db-service';
import { useModuleStore } from '../store';
import type {
  LibraryHostAPI,
  LyricsHostAPI,
  MediaItem,
  MediaRef,
  MediaType as PublicMediaType,
  PlayerHostAPI,
  PresentationHostAPI,
  QueueHostAPI,
  ThemesHostAPI,
} from '../types';
import { globalBus } from './bus';

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

async function ensureMediaWindow(): Promise<void> {
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
  }

  if (win) {
    const visible = await win.isVisible().catch(() => false);
    if (!visible) await win.show().catch(() => {});
  }
}

export function createPresentationHostAPI(): PresentationHostAPI {
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
      useModuleStore.getState().projectPanel(viewId, props);
      globalBus.emit('presentation:project', { viewId, props });
      ensureMediaWindow()
        .then(() => emit('module:presenter-project', { viewId, props }))
        .catch(() => {});
    },
    clear() {
      useModuleStore.getState().clearPresenter();
      globalBus.emit('presentation:clear');
      emit('module:presenter-clear').catch(() => {});
    },
    isWindowOpen() {
      return useModuleStore.getState().presenterViewId !== null;
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
  };
}
