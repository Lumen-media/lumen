import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventListener, useIsomorphicLayoutEffect, useWindowSize } from 'usehooks-ts';
import { useProfiles } from '@/hooks/use-profiles';
import { type LyricData, parseLyricFile } from '@/services/lyric-service';
import { useProfileStore } from '@/stores/profile-store';

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
    let url: string;
    readFile(path)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes]));
        setSrc(url);
      })
      .catch(() => setSrc(undefined));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  return src;
}

function useSlideBgSrc(path?: string) {
  const [displayedSrc, setDisplayedSrc] = useState<string | undefined>();
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!path) {
      setDisplayedSrc(undefined);
      return;
    }
    if (path.startsWith('http') || path.startsWith('#')) {
      const img = new Image();
      img.onload = () => setDisplayedSrc(path);
      img.src = path;
      return;
    }

    let revoked = false;
    readFile(path)
      .then((bytes) => {
        if (revoked) return;
        const url = URL.createObjectURL(new Blob([bytes]));
        blobUrlsRef.current.push(url);
        setDisplayedSrc(url);

        while (blobUrlsRef.current.length > 1) {
          URL.revokeObjectURL(blobUrlsRef.current.shift()!);
        }
      })
      .catch(() => setDisplayedSrc(undefined));

    return () => {
      revoked = true;
    };
  }, [path]);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = [];
    };
  }, []);

  return displayedSrc;
}

export function LyricPresentation({
  filePath,
  startIndex = 0,
  hideLyrics = false,
  useProfileWallpaper = false,
  blackoutActive = false,
}: {
  filePath: string;
  startIndex?: number;
  hideLyrics?: boolean;
  useProfileWallpaper?: boolean;
  blackoutActive?: boolean;
}) {
  useProfiles();
  const { profiles, activeProfileId } = useProfileStore();
  const profileBackground =
    profiles.find((p) => p.id === activeProfileId)?.defaultBackground?.src ?? undefined;

  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [currentSlide, setCurrentSlide] = useState(startIndex);
  const textRef = useRef<HTMLDivElement>(null);
  const startIndexRef = useRef(startIndex);
  startIndexRef.current = startIndex;
  const lyricDataRef = useRef(lyricData);
  lyricDataRef.current = lyricData;
  const { width: winW, height: winH } = useWindowSize();
  const availableH = winH - winW * 0.1;

  useEffect(() => {
    if (!filePath) return;
    readTextFile(filePath)
      .then((content) => {
        const data = parseLyricFile(content);
        setLyricData(data);
        setCurrentSlide(startIndexRef.current);
      })
      .catch(console.error);
  }, [filePath]);

  useEffect(() => {
    const data = lyricDataRef.current;
    if (!data) return;
    const clamped = Math.max(0, Math.min(startIndex, data.slides.length - 1));
    setCurrentSlide(clamped);
  }, [startIndex]);

  useEffect(() => {
    if (!lyricData || !filePath) return;
    const slide = lyricData.slides[currentSlide];
    const parsedFontSize = Number.parseInt(lyricData.metadata.fontSize, 10);
    const fontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : 48;
    const background = useProfileWallpaper
      ? profileBackground
      : slide?.background || lyricData.metadata.globalBackground || profileBackground || undefined;

    if (blackoutActive) {
      invoke('push_stream_blank').catch(() => {});
      return;
    }

    const shouldHideLyrics = hideLyrics || useProfileWallpaper;
    const lines = shouldHideLyrics ? [] : (slide?.lines ?? []);

    emit('lyric-slide-changed', {
      filePath,
      slideIndex: currentSlide,
      totalSlides: lyricData.slides.length,
      lines,
      font: lyricData.metadata.font || undefined,
      fontSize,
      alignment: lyricData.metadata.alignment || 'center',
      background,
      active: true,
    }).catch(() => { });

    invoke('push_stream_slide', {
      update: {
        lines,
        font: lyricData.metadata.font || null,
        font_size: fontSize,
        alignment: lyricData.metadata.alignment || 'center',
        background: background ?? null,
        slide_index: currentSlide,
        total_slides: lyricData.slides.length,
        active: true,
      },
    }).catch(() => { });
  }, [blackoutActive, currentSlide, filePath, hideLyrics, lyricData, profileBackground, useProfileWallpaper]);

  const totalSlides = lyricData?.slides.length ?? 0;
  const [textVisible, setTextVisible] = useState(true);
  const pendingSlideRef = useRef<number | null>(null);
  const fadeMs = 250;

  const changeSlide = useCallback((next: number) => {
    setTextVisible(false);
    pendingSlideRef.current = next;
    setTimeout(() => {
      setCurrentSlide(next);
      setTextVisible(true);
      pendingSlideRef.current = null;
    }, fadeMs);
  }, []);

  const goNext = useCallback(() => {
    if (!lyricData || pendingSlideRef.current !== null) return;
    if (currentSlide >= totalSlides - 1) return;
    changeSlide(currentSlide + 1);
  }, [currentSlide, totalSlides, lyricData, changeSlide]);

  const goPrev = useCallback(() => {
    if (pendingSlideRef.current !== null) return;
    if (currentSlide <= 0) return;
    changeSlide(currentSlide - 1);
  }, [currentSlide, changeSlide]);

  useEffect(() => {
    const unlistenNext = listen('next', () => goNext());
    const unlistenPrev = listen('previous', () => goPrev());
    const unlistenStartSlide = listen<{ startIndex: number }>('lyric-start-slide', (e) => {
      const data = lyricDataRef.current;
      if (!data) return;
      const clamped = Math.max(0, Math.min(e.payload.startIndex, data.slides.length - 1));
      changeSlide(clamped);
    });

    return () => {
      unlistenNext.then((f) => f());
      unlistenPrev.then((f) => f());
      unlistenStartSlide.then((f) => f());
    };
  }, [goNext, goPrev, changeSlide]);

  useEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'Home') {
      e.preventDefault();
      changeSlide(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      changeSlide(Math.max(totalSlides - 1, 0));
    }
  });

  const slide = lyricData?.slides[currentSlide];
  const fontSizeNum = Number.parseFloat(lyricData?.metadata.fontSize ?? '48') || 48;

  useIsomorphicLayoutEffect(() => {
    const text = textRef.current;
    if (!text || !slide) return;

    let lo = 1;
    let hi = fontSizeNum;

    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      text.style.fontSize = `${mid}px`;
      if (text.scrollHeight <= availableH) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    text.style.fontSize = `${lo}px`;
    if (text.scrollHeight > availableH) {
      text.style.fontSize = `${Math.max(lo - 1, 1)}px`;
    }
  });

  const globalBgSrc = useBackgroundSrc(
    useProfileWallpaper ? profileBackground : lyricData?.metadata.globalBackground || profileBackground
  );
  const slideBgSrc = useSlideBgSrc(useProfileWallpaper ? undefined : slide?.background);

  if (!lyricData || !slide) {
    return <div className="h-full w-full bg-black" />;
  }

  const textAlign = (lyricData.metadata.alignment || 'center') as React.CSSProperties['textAlign'];

  return (
    <div className="h-full w-full bg-black relative overflow-hidden">
      {globalBgSrc && (
        <img
          src={globalBgSrc}
          alt=""
          className="absolute inset-0 z-0 w-full h-full object-cover"
          aria-hidden
        />
      )}

      {slideBgSrc && (
        <img
          src={slideBgSrc}
          alt=""
          className="absolute inset-0 z-1 w-full h-full object-cover"
          aria-hidden
        />
      )}

      <div
        className="absolute inset-0 z-2 flex items-center justify-center overflow-hidden p-[5%]"
        style={{
          opacity: textVisible && !hideLyrics && !useProfileWallpaper ? 1 : 0,
          transition: `opacity ${fadeMs}ms ease`,
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
            return <div key={`${currentSlide}-${id}`}>{line}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
