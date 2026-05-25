import type {
  LibraryHostAPI,
  LyricsHostAPI,
  PlayerHostAPI,
  PresentationHostAPI,
  QueueHostAPI,
  ThemesHostAPI,
} from '../types';
import { globalBus } from './bus';

export function createLyricsHostAPI(): LyricsHostAPI {
  return {
    async list(_query) {
      return [];
    },
    async get(_id) {
      return null;
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
    async list(_type, _query) {
      return [];
    },
    async get(_id) {
      return null;
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

export function createPresentationHostAPI(): PresentationHostAPI {
  return {
    state() {
      return 'idle';
    },
    project(viewId, props) {
      globalBus.emit('presentation:project', { viewId, props });
    },
    clear() {
      globalBus.emit('presentation:clear');
    },
    isWindowOpen() {
      return false;
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
