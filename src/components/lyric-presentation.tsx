import { listen } from '@tauri-apps/api/event';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';
import { type LyricData, parseLyricFile } from '@/services/lyric-service';

const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;
const AVAILABLE_H = VIRTUAL_H - VIRTUAL_W * 0.1;

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

export function LyricPresentation({ filePath }: { filePath: string }) {
  const [lyricData, setLyricData] = useState<LyricData | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null!);
  const textRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setContainerWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const scale = containerWidth / VIRTUAL_W;

  useEffect(() => {
    if (!filePath) return;
    readTextFile(filePath)
      .then((content) => {
        const data = parseLyricFile(content);
        setLyricData(data);
        setCurrentSlide(0);
      })
      .catch(console.error);
  }, [filePath]);

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

    return () => {
      unlistenNext.then((f) => f());
      unlistenPrev.then((f) => f());
    };
  }, [goNext, goPrev]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev]);

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
      if (text.scrollHeight <= AVAILABLE_H) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    text.style.fontSize = `${lo}px`;
    if (text.scrollHeight > AVAILABLE_H) {
      text.style.fontSize = `${Math.max(lo - 1, 1)}px`;
    }
  });

  const globalBgSrc = useBackgroundSrc(lyricData?.metadata.globalBackground);
  const slideBgSrc = useSlideBgSrc(slide?.background);

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
          className="absolute inset-0 z-[1] w-full h-full object-cover"
          aria-hidden
        />
      )}

      <div ref={containerRef} className="absolute inset-0 z-[2]">
        <div
          className="absolute top-1/2 left-1/2 flex items-center justify-center overflow-hidden"
          style={{
            width: `${VIRTUAL_W}px`,
            height: `${VIRTUAL_H}px`,
            padding: '5%',
            transform: `translate(-50%, -50%) scale(${scale})`,
            opacity: scale > 0 && textVisible ? 1 : 0,
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
    </div>
  );
}
