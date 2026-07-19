import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readFile } from '@tauri-apps/plugin-fs';
import { toJpeg } from 'html-to-image';
import { Loader2, Plus, PresentationIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type FileInfo, fileManagementService } from '@/services';
import { type PresentationSlide, usePresentationStore } from '@/stores/presentation-store';

export const Route = createFileRoute('/_layout/presentation')({
  component: RouteComponent,
});

const PRESENTATION_PREVIEW_STORAGE_KEY = 'lumen:presentation-preview-file';
const PRESENTATION_PREVIEW_EVENT = 'lumen:presentation-preview-selected';

type PreviewState = {
  filePath: string;
  fileName: string;
  currentSlide: number;
  totalSlides: number;
  slides: PresentationSlide[];
};

type PresentationPreviewEvent = CustomEvent<{ filePath: string }>;

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function selectPresentationPreview(filePath: string) {
  localStorage.setItem(PRESENTATION_PREVIEW_STORAGE_KEY, filePath);
  window.dispatchEvent(new CustomEvent(PRESENTATION_PREVIEW_EVENT, { detail: { filePath } }));
}

async function ensureMediaWindow(): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel('media-window');
  if (existing) return existing;

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out')), 3000);
    listen('media-window-ready', () => {
      clearTimeout(timeout);
      resolve();
    }).catch(() => { });
  });

  await invoke('create_window', { label: 'media-window', title: 'Media Player' });
  await readyPromise;

  return WebviewWindow.getByLabel('media-window');
}

function PresentationPreviewRenderer({
  filePath,
  onSlidesChange,
}: {
  filePath: string | null;
  onSlidesChange: (slides: PresentationSlide[], totalSlides: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filePath) return;
    const container = containerRef.current;
    if (!container) return;

    const targetFilePath: string = filePath;
    const targetContainer: HTMLDivElement = container;

    let cancelled = false;
    let viewer: PptxViewer | null = null;

    async function renderPreview() {
      try {
        targetContainer.replaceChildren();
        const bytes = await readFile(targetFilePath);
        if (cancelled) return;

        viewer = await PptxViewer.open(bytes.buffer, targetContainer, {
          renderMode: 'slide',
          fitMode: 'contain',
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });

        if (cancelled) return;

        const count = viewer.slideCount;
        const placeholders = Array.from({ length: count }, (_, index) => ({
          index,
          thumbnail: '',
          label: `Slide ${index + 1}`,
        }));
        onSlidesChange(placeholders, count);

        const thumbs: PresentationSlide[] = [];
        for (let i = 0; i < count; i++) {
          if (cancelled) return;

          const wrapper = document.createElement('div');
          wrapper.style.position = 'absolute';
          wrapper.style.left = '-9999px';
          wrapper.style.overflow = 'hidden';
          wrapper.style.width = '320px';
          document.body.appendChild(wrapper);

          const thumbnail = viewer.renderThumbnailToContainer(i, wrapper, { width: 320 });
          await thumbnail?.ready;

          let dataUrl = '';
          if (thumbnail?.element) {
            try {
              dataUrl = await toJpeg(thumbnail.element, { quality: 0.7, pixelRatio: 2 });
            } catch {
              dataUrl = '';
            }
          }

          thumbnail?.dispose();
          wrapper.remove();
          thumbs.push({ index: i, thumbnail: dataUrl, label: `Slide ${i + 1}` });
        }

        if (!cancelled) onSlidesChange(thumbs, count);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to preview presentation:', err);
          toast.error('Failed to load presentation');
        }
      }
    }

    renderPreview();

    return () => {
      cancelled = true;
      viewer?.destroy();
      targetContainer.replaceChildren();
    };
  }, [filePath, onSlidesChange]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-[-10000px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0"
    />
  );
}

function RouteComponent() {
  const {
    isActive,
    currentSlide,
    totalSlides,
    slides,
    fileName,
    loadPresentation,
    clearPresentation,
  } = usePresentationStore();

  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(() => {
    const storedPath = localStorage.getItem(PRESENTATION_PREVIEW_STORAGE_KEY);
    return storedPath
      ? {
        filePath: storedPath,
        fileName: fileNameFromPath(storedPath),
        currentSlide: 0,
        totalSlides: 0,
        slides: [],
      }
      : null;
  });
  const currentSlideRef = useRef<HTMLButtonElement>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fileManagementService.listFiles('presentation');
      setFiles(result);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const onPreviewSelected = (event: Event) => {
      const { filePath: nextPath } = (event as PresentationPreviewEvent).detail;
      setPreview({
        filePath: nextPath,
        fileName: fileNameFromPath(nextPath),
        currentSlide: 0,
        totalSlides: 0,
        slides: [],
      });
    };

    window.addEventListener(PRESENTATION_PREVIEW_EVENT, onPreviewSelected);
    return () => window.removeEventListener(PRESENTATION_PREVIEW_EVENT, onPreviewSelected);
  }, []);

  useEffect(() => {
    const unlisten = listen('presentation:slide-changed', () => {
      currentSlideRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleImport = async () => {
    try {
      const selectedPaths = await fileManagementService.openFilePicker('presentation');
      if (!selectedPaths || selectedPaths.length === 0) return;

      await fileManagementService.uploadFiles('presentation', selectedPaths);
      await loadFiles();
      toast.success('Presentation files added');
    } catch (err) {
      console.error('Failed to import presentation:', err);
      toast.error('Failed to import presentation');
    }
  };

  const handleActivateFile = (file: FileInfo) => {
    selectPresentationPreview(file.path);
  };

  const handlePreviewSlidesChange = useCallback(
    (nextSlides: PresentationSlide[], nextTotalSlides: number) => {
      setPreview((current) =>
        current
          ? {
            ...current,
            totalSlides: nextTotalSlides,
            slides: nextSlides,
          }
          : current
      );
    },
    []
  );

  const handleSelectSlide = (slideIndex: number) => {
    if (isActive) return;
    setPreview((current) => (current ? { ...current, currentSlide: slideIndex } : current));
  };

  const handleStartPresentation = async (slideIndex: number) => {
    if (isActive) return;

    const targetPath = preview?.filePath;
    if (!targetPath) return;

    try {
      const win = await ensureMediaWindow();
      if (!win) return;

      await loadPresentation(targetPath, { initialSlide: slideIndex });
      await win.show();
      await win.setFullscreen(true);
    } catch (err) {
      console.error('Failed to open presentation:', err);
      toast.error('Failed to open presentation window');
    }
  };

  const handleClose = () => {
    if (isActive) {
      clearPresentation();
      return;
    }

    localStorage.removeItem(PRESENTATION_PREVIEW_STORAGE_KEY);
    setPreview(null);
  };

  const showingSlides = isActive || !!preview;
  const displayFileName = isActive ? fileName : preview?.fileName;
  const displayCurrentSlide = isActive ? currentSlide : (preview?.currentSlide ?? 0);
  const displayTotalSlides = isActive ? totalSlides : (preview?.totalSlides ?? 0);
  const displaySlides = isActive ? slides : (preview?.slides ?? []);

  return (
    <CardContent className="relative flex-1 min-h-0 overflow-hidden rounded-lg bg-background/80 p-0">
      <PresentationPreviewRenderer
        filePath={isActive ? null : (preview?.filePath ?? null)}
        onSlidesChange={handlePreviewSlidesChange}
      />
      {showingSlides ? (
        <div className="absolute inset-0 flex flex-col justify-start gap-4 overflow-hidden p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{displayFileName}</h2>
              <p className="text-xs text-muted-foreground">
                Slide {displayCurrentSlide + 1} of {displayTotalSlides}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleClose} className="shrink-0 gap-1.5">
              <X className="size-3.5" />
              {isActive ? 'End presentation' : 'Close'}
            </Button>
          </div>

          <ScrollArea className="flex-1" viewportClassName="focus-visible:ring-0 focus-visible:outline-none">
            <div className="flex flex-wrap gap-2 p-1">
              {displaySlides.map((slide) => (
                <button
                  key={slide.index}
                  ref={slide.index === displayCurrentSlide ? currentSlideRef : undefined}
                  type="button"
                  onClick={() => handleSelectSlide(slide.index)}
                  onDoubleClick={() => handleStartPresentation(slide.index)}
                  className={cn(
                    'shrink-0 w-36 rounded-lg overflow-hidden transition-all outline-none',
                    slide.index === displayCurrentSlide
                      ? 'ring-2 ring-primary'
                      : 'ring-1 ring-border/40 hover:ring-border/70'
                  )}
                >
                  <div className="relative aspect-video bg-black">
                    {slide.thumbnail ? (
                      <img
                        src={slide.thumbnail}
                        alt={slide.label}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span className="text-xs font-medium">{slide.label}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-1.5 text-[10px] font-medium text-center text-muted-foreground truncate">
                    {slide.label}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-start gap-4 overflow-hidden p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Presentations</h2>
            <Button variant="outline" size="sm" onClick={handleImport} className="gap-1.5">
              <Plus className="size-3.5" />
              Import
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center flex-1">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : files.length === 0 ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PresentationIcon />
                </EmptyMedia>
                <EmptyTitle>No presentations yet</EmptyTitle>
                <EmptyDescription>Import a .ppt or .pptx file to get started.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="flex-1" viewportClassName="focus-visible:ring-0 focus-visible:outline-none">
              <div className="flex flex-col gap-1">
                {files.map((file) => (
                  <Button
                    key={file.path}
                    variant="ghost"
                    className="justify-start h-auto p-3"
                    onClick={() => handleActivateFile(file)}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <PresentationIcon className="size-5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </CardContent>
  );
}
