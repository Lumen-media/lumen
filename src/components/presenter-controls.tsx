import { emit, listen } from '@tauri-apps/api/event';
import { animate } from 'animejs';
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  MonitorUp,
  Music2,
  Palette,
  Presentation,
  ScreenShareOff,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventListener, useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useModuleStore } from '@/modules/store';
import type { StageBackdropChangeDetail } from '@/modules/types';
import { type LyricData, type LyricSlide, lyricService } from '@/services/lyric-service';
import { thumbnailService } from '@/services/thumbnail-service';
import { usePlayerStore } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';
import { Card } from './ui/card';

type PresenterKind = 'lyrics' | 'image' | 'presentation';

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
}

function fileNameFromPath(path: string | null | undefined) {
  if (!path) return undefined;
  return path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '');
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

function getKindMeta(kind: PresenterKind | null) {
  if (kind === 'image') {
    return {
      icon: ImageIcon,
      label: 'Image',
      title: 'Image on screen',
      subtitle: 'Static media',
    };
  }

  if (kind === 'presentation') {
    return {
      icon: Presentation,
      label: 'PPT',
      title: 'Presentation',
      subtitle: 'Slides',
    };
  }

  return {
    icon: Music2,
    label: 'Lyric',
    title: 'Lyrics',
    subtitle: 'Hymn',
  };
}

const THUMB_VIRTUAL_W = 1920;
const THUMB_VIRTUAL_H = 1080;
const THUMB_AVAILABLE_H = THUMB_VIRTUAL_H - THUMB_VIRTUAL_W * 0.1;

function stopKeyboardShortcutPropagation(event: KeyboardEvent) {
  event.stopPropagation();
  event.stopImmediatePropagation();
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

function useFallbackSlides(kind: PresenterKind | null): FallbackSlide[] {
  return useMemo(() => {
    if (kind === 'image') {
      return [{ id: 'current-image', label: 'Current image', active: true, image: true }];
    }

    if (kind === 'presentation') {
      return Array.from({ length: 5 }, (_, index) => ({
        id: `presentation-${index}`,
        label: index === 0 ? 'Current slide' : `Slide ${index + 1}`,
        active: index === 0,
        image: index === 2,
      }));
    }

    return [];
  }, [kind]);
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
        <div className="absolute inset-0 bg-muted opacity-80" />
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
}: {
  meta: PresenterMeta;
  title: string;
  currentPosition: number;
  totalItems: number;
  isMinimized: boolean;
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
          {meta.subtitle} · Slide {currentPosition} of {totalItems || 1}
        </p>
      </div>
    </div>
  );
}

function PresenterActions({
  isMinimized,
  onToggleMinimized,
}: {
  isMinimized: boolean;
  onToggleMinimized: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="border border-border bg-background/55 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={onToggleMinimized}
        aria-label={isMinimized ? 'Expand presenter controls' : 'Minimize presenter controls'}
        title={isMinimized ? 'Expand' : 'Minimize'}
      >
        {isMinimized ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 border border-border bg-background/55 px-2 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => emit('presenter:theme-request').catch(() => {})}
      >
        <Palette className="size-3.5" />
        Theme
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 border border-primary/25 bg-primary/10 px-2 text-xs text-primary hover:bg-primary/20"
        onClick={() => emit('presenter:go-live').catch(() => {})}
      >
        <MonitorUp className="size-3.5" />
        Go Live
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 border border-destructive/25 bg-destructive/10 px-2 text-xs text-destructive hover:bg-destructive/20"
        onClick={() => emit('presenter:blackout-toggle').catch(() => {})}
      >
        <ScreenShareOff className="size-3.5" />
        Blackout
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
        <ScrollArea className="w-full" viewportClassName="focus-visible:ring-0 focus-visible:outline-none">
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
                      emit('lyric-start-slide', { startIndex: index }).catch(() => {});
                      emit('presenter:select-slide', { kind, index }).catch(() => {});
                    }}
                  />
                ))
              : fallbackSlides.map((slide, index) => (
                  <FallbackSequenceThumbnail
                    key={slide.id}
                    slide={slide}
                    onClick={() => emit('presenter:select-slide', { kind, index }).catch(() => {})}
                  />
                ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}

export function PresenterControls({ className }: PresenterControlsProps) {
  const lyricSlideIndex = usePlayerStore((s) => s.currentLyricSlideIndex);
  const lyricTotalSlides = usePlayerStore((s) => s.currentLyricTotalSlides);
  const lyricPath = usePlayerStore((s) => s.currentLyricPath);
  const imagePath = usePlayerStore((s) => s.currentImagePath);
  const presenterViewId = useModuleStore((s) => s.presenterViewId);
  const presenter = usePresenterStageState(lyricPath, presenterViewId);
  const lyricData = usePresentedLyricData(lyricPath, presenter.kind);
  const profileBackground = useProfileBackground();
  const { isMinimized, sequenceRef, sequenceContentRef, toggle } = usePresenterCollapseAnimation();
  const fallbackSlides = useFallbackSlides(presenter.kind);
  const controlsRef = useRef<HTMLDivElement>(null);

  const lyricItems = lyricData?.slides ?? [];
  const totalItems =
    presenter.kind === 'lyrics'
      ? lyricData?.slides.length || lyricTotalSlides || 0
      : fallbackSlides.length;
  const currentIndex = presenter.kind === 'lyrics' ? lyricSlideIndex : 0;
  const currentPosition = currentIndex + 1;

  useEventListener(
    'keydown',
    (event) => {
      if (!presenter.active || !presenter.kind) return;

      const nextIndex = getPresenterNavigationIndex(event.key, currentIndex, totalItems);
      if (nextIndex === null) return;

      event.preventDefault();
      stopKeyboardShortcutPropagation(event);

      if (nextIndex === currentIndex) return;

      if (presenter.kind === 'lyrics') {
        emit('lyric-start-slide', { startIndex: nextIndex }).catch(() => {});
      }

      emit('presenter:select-slide', { kind: presenter.kind, index: nextIndex }).catch(() => {});
    },
    undefined,
    { capture: true }
  );

  useEventListener(
    'keyup',
    (event) => {
      if (!presenter.active || !presenter.kind) return;
      if (getPresenterNavigationIndex(event.key, currentIndex, totalItems) === null) return;
      stopKeyboardShortcutPropagation(event);
    },
    undefined,
    { capture: true }
  );

  const meta = getKindMeta(presenter.kind);
  const displayTitle =
    presenter.name ??
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
      aria-label="Presenter controls"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <PresenterHeader
          meta={meta}
          title={displayTitle}
          currentPosition={currentPosition}
          totalItems={totalItems}
          isMinimized={isMinimized}
        />
        <PresenterActions isMinimized={isMinimized} onToggleMinimized={toggle} />
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
