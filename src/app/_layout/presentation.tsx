import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Plus, PresentationIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { type FileInfo, fileManagementService } from '@/services';
import { usePresentationStore } from '@/stores/presentation-store';

export const Route = createFileRoute('/_layout/presentation')({
  component: RouteComponent,
});

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

  const handleOpenFile = async (file: FileInfo) => {
    try {
      const existing = WebviewWindow.getByLabel('media-window');
      let win: WebviewWindow | null = existing;

      if (!win) {
        const readyPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timed out')), 3000);
          listen('media-window-ready', () => {
            clearTimeout(timeout);
            resolve();
          }).catch(() => {});
        });

        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        await readyPromise;
        win = WebviewWindow.getByLabel('media-window');
      }

      if (!win) return;

      await loadPresentation(file.path);

      await win.show();
      await win.setFullscreen(true);
    } catch (err) {
      console.error('Failed to open presentation:', err);
      toast.error('Failed to open presentation window');
    }
  };

  return (
    <CardContent className="flex-1 rounded-lg bg-background/80 flex flex-col min-h-0">
      {isActive ? (
        <div className="flex flex-col h-full gap-4 p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{fileName}</h2>
              <p className="text-xs text-muted-foreground">
                Slide {currentSlide + 1} of {totalSlides}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={clearPresentation}
              className="shrink-0 gap-1.5"
            >
              <X className="size-3.5" />
              End presentation
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="flex flex-wrap gap-2">
              {slides.map((slide) => (
                <button
                  key={slide.index}
                  ref={slide.index === currentSlide ? currentSlideRef : undefined}
                  type="button"
                  onClick={() => usePresentationStore.getState().setSlide(slide.index)}
                  className={cn(
                    'shrink-0 w-36 rounded-lg overflow-hidden transition-all outline-none',
                    slide.index === currentSlide
                      ? 'ring-2 ring-primary'
                      : 'ring-1 ring-border/40 hover:ring-border/70'
                  )}
                >
                  <div className="relative aspect-video bg-muted">
                    <img
                      src={slide.thumbnail}
                      alt={slide.label}
                      className="h-full w-full object-contain bg-black"
                    />
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
        <div className="flex flex-col h-full gap-4 p-4">
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
                <EmptyDescription>
                  Import a .ppt or .pptx file to get started.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-1">
                {files.map((file) => (
                  <Button
                    key={file.path}
                    variant="ghost"
                    className="justify-start h-auto p-3"
                    onClick={() => handleOpenFile(file)}
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
