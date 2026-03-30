import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, stat } from '@tauri-apps/plugin-fs';
import { t } from 'i18next';
import { CheckIcon, SearchIcon, VideoIcon } from 'lucide-react';
import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getThemesPath } from '@/services/app-paths';
import { extractVideoThumbnail } from '@/services/get-video-tumb';
import { mediaDbService } from '@/services/media-db-service';
import type { FileInfo } from '@/services/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from './ui/tabs';

type MediaTab = 'themes' | 'images' | 'video';

export interface SelectedBackground {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
}

export interface LyricBackgroundModalRef {
  open: (onSelect?: (bg: SelectedBackground) => void) => void;
}

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const IMAGE_EXTS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.svg']);

interface UnsplashItem {
  id: string;
  src: string | null;
  name: string;
}

const UNSPLASH_IMAGES: UnsplashItem[] = [
  {
    id: '1',
    src: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80',
    name: 'Red mountains',
  },
  {
    id: '2',
    src: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=80',
    name: 'Forest lake',
  },
  {
    id: '4',
    src: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80',
    name: 'Galaxy',
  },
  {
    id: '5',
    src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
    name: 'Snow mountains',
  },
  {
    id: '6',
    src: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=80',
    name: 'Dark mountain',
  },
  {
    id: '8',
    src: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=400&q=80',
    name: 'Waterfall',
  },
  {
    id: '10',
    src: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80',
    name: 'Milky Way',
  },
  {
    id: '11',
    src: 'https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=400&q=80',
    name: 'Mountain lake',
  },
];

interface MediaThumbnailProps {
  file: FileInfo;
  selected: boolean;
  onClick: () => void;
}

function MediaThumbnail({ file, selected, onClick }: MediaThumbnailProps) {
  const ext = file.extension.toLowerCase();
  const isVideo = VIDEO_EXTS.has(ext);
  const isImage = IMAGE_EXTS.has(ext);
  const fileSrc = convertFileSrc(file.path);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (isVideo) {
      extractVideoThumbnail(fileSrc).then(setThumbnail);
    }
  }, [fileSrc, isVideo]);

  const displaySrc = isImage ? fileSrc : thumbnail;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-background' : 'hover:opacity-90'
      )}
    >
      {displaySrc ? (
        <img src={displaySrc} alt={file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center">
          {isVideo && <VideoIcon className="size-5 text-muted-foreground" />}
        </div>
      )}
      {selected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/60 p-1.5">
            <CheckIcon className="size-4 text-white" />
          </div>
        </div>
      )}
    </button>
  );
}

function LoadingGrid() {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 my-auto gap-1 text-sm text-muted-foreground">
      <p>{message}</p>
      {hint && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export function LyricBackgroundModal({ ref }: { ref?: Ref<LyricBackgroundModalRef> }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MediaTab>('themes');
  const [selected, setSelected] = useState<SelectedBackground | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [themes, setThemes] = useState<FileInfo[]>([]);
  const [videos, setVideos] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const onSelectRef = useRef<((bg: SelectedBackground) => void) | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    open(onSelect?: (bg: SelectedBackground) => void) {
      onSelectRef.current = onSelect;
      setSelected(null);
      setSearchQuery('');
      setActiveTab('themes');
      setOpen(true);
    },
  }));

  const loadThemes = useCallback(async () => {
    setLoading(true);
    try {
      const themesPath = await getThemesPath();
      if (!(await exists(themesPath))) {
        await mkdir(themesPath, { recursive: true });
        setThemes([]);
        return;
      }
      const entries = await readDir(themesPath);
      const files: FileInfo[] = [];
      for (const entry of entries) {
        if (!entry.isFile) continue;
        const dotIdx = entry.name.lastIndexOf('.');
        const ext = dotIdx > 0 ? entry.name.substring(dotIdx) : '';
        if (!VIDEO_EXTS.has(ext.toLowerCase()) && !IMAGE_EXTS.has(ext.toLowerCase())) continue;
        const fullPath = await join(themesPath, entry.name);
        const meta = await stat(fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          size: meta.size,
          modifiedAt: meta.mtime ?? new Date(),
          extension: ext,
        });
      }
      setThemes(files);
    } catch {
      setThemes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    try {
      setVideos(await mediaDbService.listFiles('video'));
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (activeTab === 'themes') loadThemes();
    if (activeTab === 'video') loadVideos();
  }, [open, activeTab, loadThemes, loadVideos]);

  const handleConfirm = () => {
    if (selected) onSelectRef.current?.(selected);
    setOpen(false);
  };

  const filteredImages = searchQuery
    ? UNSPLASH_IMAGES.filter((img) => img.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : UNSPLASH_IMAGES;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[56.25rem] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Select Media</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as MediaTab);
            setSelected(null);
          }}
          orientation="vertical"
        >
          <div className="relative border-b border-border/50">
            <TabsList
              variant="line"
              className="w-fit justify-start px-6 rounded-none h-auto py-0 gap-4"
            >
              <TabsTrigger value="themes" className="pb-3 px-0 after:hidden">
                Themes
              </TabsTrigger>
              <TabsTrigger value="images" className="pb-3 px-0 after:hidden">
                Images
              </TabsTrigger>
              <TabsTrigger value="video" className="pb-3 px-0 after:hidden">
                Video
              </TabsTrigger>
            </TabsList>
            <TabsIndicator className="bg-primary" />
          </div>

          <TabsContent value="themes" className="px-6 py-4">
            <ScrollArea className="min-h-[25rem] h-[40dvh]" viewportClassName="flex flex-col">
              {loading ? (
                <LoadingGrid />
              ) : themes.length === 0 ? (
                <EmptyState
                  message={t("No themes found in the 'files/themes' folder.")}
                  hint={t('Add GIFs or videos to the files/themes folder.')}
                />
              ) : (
                <div className="grid grid-cols-4 gap-3 pr-1">
                  {themes.map((file) => (
                    <MediaThumbnail
                      key={file.path}
                      file={file}
                      selected={selected?.src === file.path}
                      onClick={() =>
                        setSelected({ type: 'theme', src: file.path, name: file.name })
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="images" className="px-6 py-4 flex flex-col gap-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search Unsplash..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="min-h-[22rem] h-[34dvh]">
              <div className="grid grid-cols-4 gap-3 pr-1 mt-1">
                {filteredImages.map((item) => {
                  const itemSrc = item.src ?? '#000000';
                  const isSelected = selected?.src === itemSrc;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelected({ type: 'image', src: itemSrc, name: item.name })}
                      className={cn(
                        'relative aspect-video rounded-lg overflow-hidden transition-all focus-visible:outline-none',
                        isSelected
                          ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-background'
                          : 'hover:opacity-90'
                      )}
                    >
                      {item.src ? (
                        <img
                          src={item.src}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-black" />
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <div className="rounded-full bg-black/60 p-1.5">
                            <CheckIcon className="size-4 text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="video" className="px-6 py-4">
            <ScrollArea className="min-h-[25rem] h-[40dvh]">
              {loading ? (
                <LoadingGrid />
              ) : videos.length === 0 ? (
                <EmptyState
                  message="Nenhum vídeo encontrado."
                  hint="Faça upload de vídeos para usá-los como fundo."
                />
              ) : (
                <div className="grid grid-cols-4 gap-3 pr-1">
                  {videos.map((file) => (
                    <MediaThumbnail
                      key={file.path}
                      file={file}
                      selected={selected?.src === file.path}
                      onClick={() =>
                        setSelected({ type: 'video', src: file.path, name: file.name })
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/50">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-black font-semibold hover:bg-cyan-300"
            disabled={!selected}
            onClick={handleConfirm}
          >
            Set Background
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
