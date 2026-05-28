import { createFileRoute } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { LyricData, LyricSlide } from '@/services/lyric-service';
import { thumbnailService } from '@/services/thumbnail-service';
import { useLyricEditStore } from '@/stores/lyric-edit-store';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { useProfileStore } from '@/stores/profile-store';

export const Route = createFileRoute('/_layout/edit')({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const openLyricModal = useLyricModalStore((s) => s.open);
  const { filePath, lyricData, slideIds, selectedSlideIndex, selectSlide, isLoading, restore } =
    useLyricEditStore();
  const { profiles, activeProfileId } = useProfileStore();
  const profileBackground =
    profiles.find((p) => p.id === activeProfileId)?.defaultBackground?.src ?? undefined;

  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const slideRowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const handleSelectSlide = useCallback(
    (index: number) => {
      const next = selectedSlideIndex === index ? null : index;
      selectSlide(next);
      if (next !== null) {
        thumbRefs.current
          .get(next)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        slideRowRefs.current.get(next)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    [selectedSlideIndex, selectSlide]
  );

  useEffect(() => {
    if (!filePath) restore();
  }, [filePath, restore]);

  if (!lyricData || !filePath) {
    return (
      <CardContent className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
        <p className="text-muted-foreground text-sm font-medium">
          {isLoading ? t('Loading...') : t('Select a lyric to preview')}
        </p>
      </CardContent>
    );
  }

  const songName =
    lyricData.metadata.name || filePath.split(/[\\/]/).pop()?.replace(/\.md$/, '') || '';

  return (
    <CardContent className="flex-1 flex flex-col min-h-0 p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold">
          {t('Current Song')}: {songName}
        </h2>
        <Button size="sm" onClick={() => openLyricModal(filePath)}>
          <Pencil className="size-4" />
          {t('Edit Lyrics')}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col px-6 pb-4 py-1">
          {lyricData.slides.map((slide, index) => (
            <div key={slideIds[index]}>
              {index > 0 && <Separator className="my-1" />}
              <SlideRow
                ref={(el: HTMLButtonElement | null) => {
                  if (el) slideRowRefs.current.set(index, el);
                  else slideRowRefs.current.delete(index);
                }}
                slide={slide}
                index={index}
                isSelected={selectedSlideIndex === index}
                onClick={() => handleSelectSlide(index)}
                font={lyricData.metadata.font}
              />
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-border pt-2 mx-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          {t('Sequence Preview')}
        </h3>
        <ScrollArea className="w-full">
          <div className="flex gap-3 py-1 pb-3 px-1">
            {lyricData.slides.map((slide, index) => (
              <SequenceThumbnail
                ref={(el: HTMLButtonElement | null) => {
                  if (el) thumbRefs.current.set(index, el);
                  else thumbRefs.current.delete(index);
                }}
                key={slideIds[index]}
                slide={slide}
                isSelected={selectedSlideIndex === index}
                lyricData={lyricData}
                profileBackground={profileBackground}
                onClick={() => handleSelectSlide(index)}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </CardContent>
  );
}

const SlideRow = forwardRef<
  HTMLButtonElement,
  {
    slide: LyricSlide;
    index: number;
    isSelected: boolean;
    onClick: () => void;
    font?: string;
  }
>(({ slide, index, isSelected, onClick, font }, ref) => {
  return (
    <Button
      ref={ref}
      variant="ghost"
      onClick={onClick}
      className={cn(
        'flex items-start justify-start w-full gap-4 text-left h-auto px-4 py-3 whitespace-normal',
        isSelected && 'bg-primary/10'
      )}
    >
      <span className="text-xs font-bold uppercase tracking-wider text-primary shrink-0 pt-1 min-w-16">
        {getSlideLabel(index)}
      </span>
      <div
        className="flex-1"
        style={{
          fontFamily: font || undefined,
        }}
      >
        {slide.lines.map((line) => {
          const id = crypto.randomUUID();
          return (
            <p key={id} className="text-sm font-semibold leading-relaxed">
              {line}
            </p>
          );
        })}
      </div>
    </Button>
  );
});

function getSlideLabel(index: number): string {
  return `Slide ${index + 1}`;
}

const THUMB_VIRTUAL_W = 1920;
const THUMB_VIRTUAL_H = 1080;
const THUMB_AVAILABLE_H = THUMB_VIRTUAL_H - THUMB_VIRTUAL_W * 0.1;

function useBackgroundSrc(path?: string) {
  const [src, setSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!path) {
      setSrc(undefined);
      return;
    }
    if (path.startsWith('http') || path.startsWith('#')) {
      setSrc(path);
      return;
    }
    let cancelled = false;
    thumbnailService.getThumbnail(path)
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => setSrc(undefined));
    return () => { cancelled = true; };
  }, [path]);

  return src;
}

const SequenceThumbnail = forwardRef<
  HTMLButtonElement,
  {
    slide: LyricSlide;
    isSelected: boolean;
    lyricData: LyricData;
    profileBackground?: string;
    onClick: () => void;
  }
>(({ slide, isSelected, lyricData, profileBackground, onClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null!);
  const textRef = useRef<HTMLDivElement>(null);
  const { width: containerWidth = 0 } = useResizeObserver({ ref: containerRef });
  const scale = containerWidth / THUMB_VIRTUAL_W;
  const fontSizeNum = Number.parseFloat(lyricData.metadata.fontSize) || 48;

  const effectiveBg = slide.background || lyricData.metadata.globalBackground || profileBackground;
  const bgSrc = useBackgroundSrc(effectiveBg);

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

  const textAlign = (lyricData.metadata.alignment || 'center') as React.CSSProperties['textAlign'];

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 w-40 rounded-lg overflow-hidden transition-all outline-none',
        isSelected ? 'ring-2 ring-primary' : 'ring-1 ring-border/30 hover:ring-border/60'
      )}
    >
      <div ref={containerRef} className="relative aspect-video bg-black">
        {bgSrc && (
          <img
            src={bgSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            aria-hidden
          />
        )}
        <div
          className="absolute top-1/2 left-1/2 flex items-center justify-center overflow-hidden pointer-events-none"
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
            className="text-white uppercase leading-relaxed w-full font-semibold"
            style={{
              textAlign,
              fontFamily: lyricData.metadata.font || undefined,
            }}
          >
            {slide.lines.map((line) => {
              const id = crypto.randomUUID();
              return <div key={id}>{line}</div>;
            })}
          </div>
        </div>
      </div>
    </button>
  );
});
