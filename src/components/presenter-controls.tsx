import { emit, listen } from '@tauri-apps/api/event';
import { animate } from 'animejs';
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Music2,
  Presentation,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEventListener, useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PresenterControlsSlot } from '@/modules/components/PresenterControlsSlot';
import { useModuleStore } from '@/modules/store';
import type { StageBackdropChangeDetail } from '@/modules/types';
import { type LyricData, type LyricSlide, lyricService } from '@/services/lyric-service';
import { thumbnailService } from '@/services/thumbnail-service';
import { usePlayerStore } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';
import { Card } from './ui/card';

type PresenterKind = 'lyrics' | 'image' | 'presentation';

type Translate = (key: string, params?: Record<string, string | number>) => string;

type PresenterMeta = ReturnType<typeof getKindMeta>;

interface PresenterState {
  active: boolean;
  kind: PresenterKind | null;
  name?: string | null;
}

interface PresenterControlsProps {
  className?: string;
}

interface FallbackSlide {
  id: string;
  label: string;
  active: boolean;
  image: boolean;
  source?: string | null;
}

interface PresenterDisplayState {
  wallpaper: boolean;
  hideLyrics: boolean;
  blackout: boolean;
}

type PresenterDisplayMode = keyof PresenterDisplayState;
type PresenterShortcutEvent =
  | 'presenter:wallpaper-toggle'
  | 'presenter:lyrics-toggle'
  | 'presenter:blackout-toggle'
  | 'presenter:exit';

function emitPresenterEvent(event: PresenterShortcutEvent) {
  emit(event).catch(() => { });
}

function fileNameFromPath(path: string | null | undefined) {
  if (!path) return undefined;
  return path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^/.]+$/, '');
}

function getInitialPresenterState(): PresenterState {
  const player = usePlayerStore.getState();
  const moduleStore = useModuleStore.getState();

  if (player.currentLyricPath) {
    return {
      active: true,
      kind: 'lyrics',
      name: fileNameFromPath(player.currentLyricPath),
    };
  }

  if (player.currentImagePath) {
    return {
      active: true,
      kind: 'image',
      name: fileNameFromPath(player.currentImagePath),
    };
  }

  if (moduleStore.presenterViewId) {
    return {
      active: true,
      kind: 'presentation',
      name: 'Presentation',
    };
  }

  return { active: false, kind: null };
}

function stateFromBackdrop(detail: StageBackdropChangeDetail): PresenterState {
  if (!detail.active) return { active: false, kind: null };

  if (detail.mediaType === 'lyrics') {
    return {
      active: true,
      kind: 'lyrics',
      name: detail.name ?? fileNameFromPath(usePlayerStore.getState().currentLyricPath),
    };
  }

  if (detail.mediaType === 'image') {
    return {
      active: true,
      kind: 'image',
      name: detail.name ?? fileNameFromPath(usePlayerStore.getState().currentImagePath),
    };
  }

  if (detail.source === 'scene') {
    return {
      active: true,
      kind: 'presentation',
      name: detail.name ?? 'Presentation',
    };
  }

  return { active: false, kind: null };
}

function getKindMeta(kind: PresenterKind | null, t: Translate) {
  if (kind === 'image') {
    return {
      icon: ImageIcon,
      label: t('Image'),
      title: t('Image on screen'),
      subtitle: t('Static media'),
    };
  }

  if (kind === 'presentation') {
    return {
      icon: Presentation,
      label: t('PPT'),
      title: t('Presentation'),
      subtitle: t('Slides'),
    };
  }

  return {
    icon: Music2,
    label: t('Lyric'),
    title: t('Lyrics'),
    subtitle: t('Hymn'),
  };
}

const THUMB_VIRTUAL_W = 1920;
const THUMB_VIRTUAL_H = 1080;
const THUMB_AVAILABLE_H = THUMB_VIRTUAL_H - THUMB_VIRTUAL_W * 0.1;

function stopKeyboardShortcutPropagation(event: KeyboardEvent) {
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function emitPresenterShortcut(key: string) {
  if (key === 'F8') {
    emitPresenterEvent('presenter:wallpaper-toggle');
    return true;
  }

  if (key === 'F9') {
    emitPresenterEvent('presenter:lyrics-toggle');
    return true;
  }

  if (key === 'F10') {
    emitPresenterEvent('presenter:blackout-toggle');
    return true;
  }

  if (key === 'Escape') {
    emitPresenterEvent('presenter:exit');
    return true;
  }

  return false;
}
function getPresenterNavigationIndex(key: string, currentIndex: number, totalItems: number) {
  if (totalItems <= 0) return null;

  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown') {
    return Math.min(currentIndex + 1, totalItems - 1);
  }

  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
    return Math.max(currentIndex - 1, 0);
  }

  if (key === 'Home') return 0;
  if (key === 'End') return totalItems - 1;

  return null;
}

function useBackgroundSrc(path?: string) {
  const [src, setSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!path) {
      setSrc(undefined);
      return;
    }

    if (path.startsWith('http') || path.startsWith('#') || path.startsWith('blob:')) {
      setSrc(path);
      return;
    }

    let cancelled = false;
    thumbnailService
      .getThumbnail(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => setSrc(undefined));

    return () => {
      cancelled = true;
    };
  }, [path]);

  return src;
}

function usePresenterStageState(lyricPath: string | null, presenterViewId: string | null) {
  const [presenter, setPresenter] = useState<PresenterState>(() => getInitialPresenterState());

  useEffect(() => {
    const unlistenBackdrop = listen<StageBackdropChangeDetail>('stage-backdrop-change', (event) => {
      setPresenter(stateFromBackdrop(event.payload));
    });

    const unlistenProject = listen('module:presenter-project', () => {
      setPresenter({ active: true, kind: 'presentation', name: 'Presentation' });
    });

    const unlistenClear = listen('module:presenter-clear', () => {
      setPresenter({ active: false, kind: null });
    });

    return () => {
      unlistenBackdrop.then((unlisten) => unlisten());
      unlistenProject.then((unlisten) => unlisten());
      unlistenClear.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (lyricPath) {
      setPresenter((current) =>
        current.kind === 'lyrics'
          ? { ...current, active: true, name: current.name ?? fileNameFromPath(lyricPath) }
          : current
      );
    }
  }, [lyricPath]);

  useEffect(() => {
    if (presenterViewId) {
      setPresenter({ active: true, kind: 'presentation', name: 'Presentation' });
    }
  }, [presenterViewId]);

  return presenter;
}

function usePresentedLyricData(lyricPath: string | null, kind: PresenterKind | null) {
  const [lyricData, setLyricData] = useState<LyricData | null>(null);

  useEffect(() => {
    if (!lyricPath || kind !== 'lyrics') {
      setLyricData(null);
      return;
    }

    let cancelled = false;
    lyricService
      .load(lyricPath)
      .then((data) => {
        if (!cancelled) setLyricData(data);
      })
      .catch(() => {
        if (!cancelled) setLyricData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [lyricPath, kind]);

  return lyricData;
}

function useProfileBackground() {
  const { profiles, activeProfileId } = useProfileStore();
  return profiles.find((profile) => profile.id === activeProfileId)?.defaultBackground?.src;
}

function usePresenterCollapseAnimation() {
  const [isMinimized, setIsMinimized] = useState(false);
  const sequenceRef = useRef<HTMLDivElement>(null);
  const sequenceContentRef = useRef<HTMLDivElement>(null);
  const heightAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  const sequenceAnimationRef = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    return () => {
      heightAnimationRef.current?.cancel();
      sequenceAnimationRef.current?.cancel();
    };
  }, []);

  const toggle = () => {
    const sequence = sequenceRef.current;
    const content = sequenceContentRef.current;

    heightAnimationRef.current?.cancel();
    sequenceAnimationRef.current?.cancel();

    if (!sequence) {
      setIsMinimized((value) => !value);
      return;
    }

    sequence.style.overflow = 'hidden';

    if (!isMinimized) {
      sequence.style.height = `${sequence.scrollHeight}px`;
      setIsMinimized(true);

      heightAnimationRef.current = animate(sequence, {
        height: '0px',
        opacity: 0,
        duration: 260,
        ease: 'outCubic',
        onComplete: () => {
          sequence.style.height = '0px';
          sequence.style.overflow = 'hidden';
        },
      });

      if (content) {
        sequenceAnimationRef.current = animate(content, {
          opacity: 0,
          scale: 0.96,
          translateY: -8,
          duration: 210,
          ease: 'outCubic',
        });
      }
      return;
    }

    setIsMinimized(false);

    requestAnimationFrame(() => {
      const targetHeight = sequence.scrollHeight;
      sequence.style.height = '0px';
      sequence.style.opacity = '0';

      if (content) {
        content.style.opacity = '0';
        content.style.transform = 'translateY(-8px) scale(0.96)';
      }

      heightAnimationRef.current = animate(sequence, {
        height: `${targetHeight}px`,
        opacity: 1,
        duration: 320,
        ease: 'outCubic',
        onComplete: () => {
          sequence.style.height = '';
          sequence.style.overflow = '';
          sequence.style.opacity = '';
        },
      });

      if (content) {
        sequenceAnimationRef.current = animate(content, {
          opacity: 1,
          scale: 1,
          translateY: 0,
          duration: 260,
          delay: 40,
          ease: 'outCubic',
        });
      }
    });
  };

  return { isMinimized, sequenceRef, sequenceContentRef, toggle };
}

function useFallbackSlides(
  kind: PresenterKind | null,
  imagePath: string | null | undefined,
  t: Translate
): FallbackSlide[] {
  return useMemo(() => {
    if (kind === 'image') {
      return [
        {
          id: 'current-image',
          label: t('Current image'),
          active: true,
          image: true,
          source: imagePath,
        },
      ];
    }

    if (kind === 'presentation') {
      return Array.from({ length: 5 }, (_, index) => ({
        id: `presentation-${index}`,
        label: index === 0 ? t('Current slide') : t('Slide {{number}}', { number: index + 1 }),
        active: index === 0,
        image: index === 2,
      }));
    }

    return [];
  }, [imagePath, kind, t]);
}

function LyricSequenceThumbnail({
  slide,
  isSelected,
  lyricData,
  profileBackground,
  onClick,
}: {
  slide: LyricSlide;
  isSelected: boolean;
  lyricData: LyricData;
  profileBackground?: string;
  onClick: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const textRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth = 0 } = useResizeObserver({ ref: containerRef });
  const scale = containerWidth / THUMB_VIRTUAL_W;
  const fontSizeNum = Number.parseFloat(lyricData.metadata.fontSize) || 48;
  const effectiveBg = slide.background || lyricData.metadata.globalBackground || profileBackground;
  const bgSrc = useBackgroundSrc(effectiveBg);
  const textAlign = (lyricData.metadata.alignment || 'center') as React.CSSProperties['textAlign'];

  useIsomorphicLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;

    let lo = 1;
    let hi = fontSizeNum;

    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      text.style.fontSize = `${mid}px`;
      if (text.scrollHeight <= THUMB_AVAILABLE_H) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    text.style.fontSize = `${lo}px`;
    if (text.scrollHeight > THUMB_AVAILABLE_H) {
      text.style.fontSize = `${Math.max(lo - 1, 1)}px`;
    }
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 w-40 rounded-lg overflow-hidden transition-all outline-none',
        isSelected ? 'ring-2 ring-primary' : 'ring-1 ring-border/40 hover:ring-border/70'
      )}
    >
      <div ref={containerRef} className="relative aspect-video bg-black">
        {bgSrc && (
          <img
            src={bgSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            aria-hidden
          />
        )}
        <div
          className="absolute left-1/2 top-1/2 flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            width: `${THUMB_VIRTUAL_W}px`,
            height: `${THUMB_VIRTUAL_H}px`,
            padding: '5%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            opacity: scale > 0 ? 1 : 0,
          }}
        >
          <div
            ref={textRef}
            className="w-full text-white uppercase leading-relaxed font-semibold"
            style={{
              textAlign,
              fontFamily: lyricData.metadata.font || undefined,
            }}
          >
            {slide.lines.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

function FallbackSequenceThumbnail({
  slide,
  onClick,
}: {
  slide: FallbackSlide;
  onClick: () => void;
}) {
  const imageSrc = useBackgroundSrc(slide.image ? (slide.source ?? undefined) : undefined);

  return (
    <button
      type="button"
      className={cn(
        'relative h-[90px] w-40 shrink-0 overflow-hidden rounded-lg border bg-muted/30 text-left transition-colors',
        slide.active
          ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.45)]'
          : 'border-border/60 hover:border-border'
      )}
      onClick={onClick}
    >
      {slide.image ? (
        imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : (
          <div className="absolute inset-0 bg-muted opacity-80" />
        )
      ) : (
        <div className="flex h-full items-center justify-center px-3 text-center text-[10px] font-semibold text-muted-foreground">
          {slide.label}
        </div>
      )}
    </button>
  );
}

function PresenterHeader({
  meta,
  title,
  currentPosition,
  totalItems,
  isMinimized,
  t,
}: {
  meta: PresenterMeta;
  title: string;
  currentPosition: number;
  totalItems: number;
  isMinimized: boolean;
  t: Translate;
}) {
  const Icon = meta.icon;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary',
          isMinimized ? 'size-8' : 'size-9'
        )}
      >
        <Icon className={cn(isMinimized ? 'size-4' : 'size-5')} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold leading-tight text-foreground">{title}</h2>
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-normal text-primary">
            {meta.label}
          </span>
        </div>
        <p className="truncate text-xs leading-tight text-muted-foreground">
          {meta.subtitle} ·{' '}
          {t('Slide {{current}} of {{total}}', {
            current: currentPosition,
            total: totalItems || 1,
          })}
        </p>
      </div>
    </div>
  );
}

function ShortcutLabel({ shortcut, label }: { shortcut?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {shortcut && (
        <span className="font-semibold text-foreground/90 uppercase tracking-normal">
          {shortcut}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

const shortcutToggleItems = [
  {
    value: 'wallpaper',
    ariaLabel: 'Toggle wallpaper',
    shortcut: 'F8',
    label: 'wallpaper',
    event: 'presenter:wallpaper-toggle',
  },
  {
    value: 'hideLyrics',
    ariaLabel: 'Toggle lyrics visibility',
    shortcut: 'F9',
    label: 'without lyrics',
    event: 'presenter:lyrics-toggle',
  },
  {
    value: 'blackout',
    ariaLabel: 'Toggle black screen',
    shortcut: 'F10',
    label: 'black screen',
    event: 'presenter:blackout-toggle',
  },
] satisfies Array<{
  value: PresenterDisplayMode;
  ariaLabel: string;
  shortcut: string;
  label: string;
  event: Exclude<PresenterShortcutEvent, 'presenter:exit'>;
}>;

const shortcutButtonClass = 'h-7 px-2 text-xs text-muted-foreground hover:text-accent-foreground';

function PresenterShortcuts({
  activeDisplayModes,
  onPrevious,
  onNext,
  t,
}: {
  activeDisplayModes: PresenterDisplayMode[];
  onPrevious: () => void;
  onNext: () => void;
  t: Translate;
}) {
  const actionButtons = [
    {
      id: 'exit',
      shortcut: 'ESC',
      icon: undefined,
      label: 'exit',
      onClick: () => emitPresenterEvent('presenter:exit'),
    },
    { id: 'previous', shortcut: undefined, icon: SkipBack, label: 'previous', onClick: onPrevious },
    { id: 'next', shortcut: undefined, icon: SkipForward, label: 'next', onClick: onNext },
  ];

  return (
    <div className="flex items-center justify-center gap-1">
      <ToggleGroup
        multiple
        value={activeDisplayModes}
        variant="secondary"
        size="sm"
        spacing={4}
        className="rounded-md"
      >
        {shortcutToggleItems.map((item) => (
          <ToggleGroupItem
            key={item.value}
            value={item.value}
            aria-label={t(item.ariaLabel)}
            className="h-7 rounded-md px-2 text-xs"
            onClick={() => emitPresenterEvent(item.event)}
          >
            <ShortcutLabel shortcut={item.shortcut} label={t(item.label)} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {actionButtons.map(({ id, icon: Icon, shortcut, label, onClick }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="sm"
          className={shortcutButtonClass}
          onClick={onClick}
        >
          {Icon ? (
            <Icon className="size-3" />
          ) : (
            <ShortcutLabel shortcut={shortcut} label={t(label)} />
          )}
          {Icon ? t(label) : null}
        </Button>
      ))}
    </div>
  );
}

function PresenterActions({
  isMinimized,
  onToggleMinimized,
  t,
}: {
  isMinimized: boolean;
  onToggleMinimized: () => void;
  t: Translate;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="border border-border bg-background/55 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={onToggleMinimized}
        aria-label={isMinimized ? t('Expand presenter controls') : t('Minimize presenter controls')}
        title={isMinimized ? t('Expand') : t('Minimize')}
      >
        {isMinimized ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </Button>
    </div>
  );
}

function PresenterSequence({
  kind,
  lyricData,
  lyricItems,
  lyricSlideIndex,
  profileBackground,
  fallbackSlides,
  sequenceRef,
  sequenceContentRef,
  isMinimized,
}: {
  kind: PresenterKind;
  lyricData: LyricData | null;
  lyricItems: LyricSlide[];
  lyricSlideIndex: number;
  profileBackground?: string;
  fallbackSlides: FallbackSlide[];
  sequenceRef: React.RefObject<HTMLDivElement | null>;
  sequenceContentRef: React.RefObject<HTMLDivElement | null>;
  isMinimized: boolean;
}) {
  return (
    <div
      ref={sequenceRef}
      className={cn(
        'overflow-hidden border-t border-border',
        isMinimized ? 'h-0 border-transparent pt-0 opacity-0 pointer-events-none' : 'pt-3'
      )}
    >
      <div ref={sequenceContentRef}>
        <ScrollArea
          className="w-full"
          viewportClassName="focus-visible:ring-0 focus-visible:outline-none"
        >
          <div className="flex gap-3 px-1 pb-3 pt-1">
            {kind === 'lyrics' && lyricData
              ? lyricItems.map((slide, index) => (
                <LyricSequenceThumbnail
                  key={`${index}-${slide.lines.join('|')}`}
                  slide={slide}
                  isSelected={lyricSlideIndex === index}
                  lyricData={lyricData}
                  profileBackground={profileBackground}
                  onClick={() => {
                    emit('lyric-start-slide', { startIndex: index }).catch(() => { });
                    emit('presenter:select-slide', { kind, index }).catch(() => { });
                  }}
                />
              ))
              : fallbackSlides.map((slide, index) => (
                <FallbackSequenceThumbnail
                  key={slide.id}
                  slide={slide}
                  onClick={() => emit('presenter:select-slide', { kind, index }).catch(() => { })}
                />
              ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <PresenterControlsSlot />
      </div>
    </div>
  );
}

export function PresenterControls({ className }: PresenterControlsProps) {
  const { t } = useTranslation();
  const lyricSlideIndex = usePlayerStore((s) => s.currentLyricSlideIndex);
  const lyricTotalSlides = usePlayerStore((s) => s.currentLyricTotalSlides);
  const lyricPath = usePlayerStore((s) => s.currentLyricPath);
  const imagePath = usePlayerStore((s) => s.currentImagePath);
  const presenterViewId = useModuleStore((s) => s.presenterViewId);
  const presenter = usePresenterStageState(lyricPath, presenterViewId);
  const lyricData = usePresentedLyricData(lyricPath, presenter.kind);
  const profileBackground = useProfileBackground();
  const { isMinimized, sequenceRef, sequenceContentRef, toggle } = usePresenterCollapseAnimation();
  const fallbackSlides = useFallbackSlides(presenter.kind, imagePath, t);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [displayState, setDisplayState] = useState<PresenterDisplayState>({
    wallpaper: false,
    hideLyrics: false,
    blackout: false,
  });

  useEffect(() => {
    const unlistenDisplayState = listen<PresenterDisplayState>('presenter:display-state', (event) =>
      setDisplayState(event.payload)
    );

    return () => {
      unlistenDisplayState.then((unlisten) => unlisten());
    };
  }, []);

  const activeDisplayModes = useMemo(
    () =>
      Object.entries(displayState)
        .filter(([, active]) => active)
        .map(([key]) => key) as PresenterDisplayMode[],
    [displayState]
  );

  const lyricItems = lyricData?.slides ?? [];
  const totalItems =
    presenter.kind === 'lyrics'
      ? lyricData?.slides.length || lyricTotalSlides || 0
      : fallbackSlides.length;
  const currentIndex = presenter.kind === 'lyrics' ? lyricSlideIndex : 0;
  const currentPosition = currentIndex + 1;

  const selectPresenterIndex = useCallback(
    (index: number) => {
      if (!presenter.kind || totalItems <= 0) return;

      const nextIndex = Math.max(0, Math.min(index, totalItems - 1));
      if (nextIndex === currentIndex) return;

      if (presenter.kind === 'lyrics') {
        emit('lyric-start-slide', { startIndex: nextIndex }).catch(() => { });
      }

      emit('presenter:select-slide', { kind: presenter.kind, index: nextIndex }).catch(() => { });
    },
    [currentIndex, presenter.kind, totalItems]
  );

  useEventListener(
    'keydown',
    (event) => {
      if (!presenter.active || !presenter.kind) return;

      if (emitPresenterShortcut(event.key)) {
        event.preventDefault();
        stopKeyboardShortcutPropagation(event);
        return;
      }

      const nextIndex = getPresenterNavigationIndex(event.key, currentIndex, totalItems);
      if (nextIndex === null) return;

      event.preventDefault();
      stopKeyboardShortcutPropagation(event);
      selectPresenterIndex(nextIndex);
    },
    undefined,
    { capture: true }
  );

  useEventListener(
    'keyup',
    (event) => {
      if (!presenter.active || !presenter.kind) return;
      if (
        !['F8', 'F9', 'F10', 'Escape'].includes(event.key) &&
        getPresenterNavigationIndex(event.key, currentIndex, totalItems) === null
      ) {
        return;
      }
      stopKeyboardShortcutPropagation(event);
    },
    undefined,
    { capture: true }
  );

  const meta = getKindMeta(presenter.kind, t);
  const presenterName = presenter.name === 'Presentation' ? t('Presentation') : presenter.name;
  const displayTitle =
    presenterName ??
    lyricData?.metadata.name ??
    (presenter.kind === 'image'
      ? fileNameFromPath(imagePath)
      : presenter.kind === 'lyrics'
        ? fileNameFromPath(lyricPath)
        : undefined) ??
    meta.title;

  if (!presenter.active || !presenter.kind) return null;
  return (
    <Card
      ref={controlsRef}
      className={cn(isMinimized ? 'min-h-10 p-2 gap-0' : 'min-h-14 gap-3', className)}
      aria-label={t('Presenter controls')}
    >
      <div className="relative flex min-w-0 items-center justify-between gap-3">
        <PresenterHeader
          meta={meta}
          title={displayTitle}
          currentPosition={currentPosition}
          totalItems={totalItems}
          isMinimized={isMinimized}
          t={t}
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <PresenterShortcuts
            activeDisplayModes={activeDisplayModes}
            onPrevious={() => selectPresenterIndex(currentIndex - 1)}
            onNext={() => selectPresenterIndex(currentIndex + 1)}
            t={t}
          />
        </div>
        <PresenterActions isMinimized={isMinimized} onToggleMinimized={toggle} t={t} />
      </div>

      <PresenterSequence
        kind={presenter.kind}
        lyricData={lyricData}
        lyricItems={lyricItems}
        lyricSlideIndex={lyricSlideIndex}
        profileBackground={profileBackground}
        fallbackSlides={fallbackSlides}
        sequenceRef={sequenceRef}
        sequenceContentRef={sequenceContentRef}
        isMinimized={isMinimized}
      />
    </Card>
  );
}
