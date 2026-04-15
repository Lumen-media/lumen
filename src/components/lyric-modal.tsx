import { useForm } from '@tanstack/react-form';
import { readFile } from '@tauri-apps/plugin-fs';
import { t } from 'i18next';
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, ImagePlus, Palette } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';
import { useLocalFonts } from '@/hooks/use-local-fonts';
import { type LyricData, lyricService } from '@/services/lyric-service';
import { useLyricModalStore } from '@/stores/lyric-modal-store';
import { useProfileStore } from '@/stores/profile-store';
import { LyricBackgroundModal, type LyricBackgroundModalRef } from './lyric-background-modal';
import { TextEditor, type TextEditorRef } from './text-editor';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Dialog, DialogClose, DialogContent } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Separator } from './ui/separator';
import { Toggle } from './ui/toggle';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

type Slide = {
  id: number;
  content: string;
  lines: string[];
};

function parseSlides(markdown: string): Slide[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];
  return normalized.split(/\n{3,}/).reduce<Slide[]>((acc, text) => {
    const trimmed = text.trim();
    if (!trimmed) return acc;
    const lines = trimmed.split(/\n+/).filter(Boolean);
    acc.push({ id: acc.length + 1, content: trimmed, lines });
    return acc;
  }, []);
}

const VIRTUAL_W = 1920;
const VIRTUAL_H = 1080;

const AVAILABLE_H = VIRTUAL_H - VIRTUAL_W * 0.1;

function SlidePreview({
  slide,
  textAlign,
  selectedFont,
  fontSizeNum,
  background,
  globalBackground,
  profileBackground,
  onSetBackground,
}: {
  slide: Slide;
  textAlign: React.CSSProperties['textAlign'];
  selectedFont: string;
  fontSizeNum: number;
  background?: string;
  globalBackground?: string;
  profileBackground?: string;
  onSetBackground: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const textRef = useRef<HTMLDivElement>(null);

  const { width: containerWidth = 0 } = useResizeObserver({ ref: containerRef });
  const scale = containerWidth / VIRTUAL_W;

  useIsomorphicLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;

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

  const effectiveBg = background || globalBackground || profileBackground;
  const [bgSrc, setBgSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!effectiveBg) {
      setBgSrc(undefined);
      return;
    }
    if (effectiveBg.startsWith('http') || effectiveBg.startsWith('#')) {
      setBgSrc(effectiveBg);
      return;
    }
    let url: string;
    readFile(effectiveBg)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes]));
        setBgSrc(url);
      })
      .catch(() => setBgSrc(undefined));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [effectiveBg]);

  return (
    <div className="relative aspect-video bg-black rounded-lg border border-border/20 overflow-hidden">
      {bgSrc && (
        <img
          src={bgSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden
        />
      )}
      <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold rounded px-1.5 py-0.5 min-w-5 text-center z-10">
        {slide.id}
      </span>
      <button
        type="button"
        onClick={onSetBackground}
        className={`absolute top-2 right-2 p-1 rounded transition-colors z-10 ${
          background ? 'bg-primary/80 hover:bg-primary/80' : 'bg-white/10 hover:bg-white/20'
        }`}
        title={background ? 'Change slide background' : 'Set slide background'}
      >
        <ImagePlus className="size-3.5 text-white" />
      </button>
      <div ref={containerRef} className="absolute inset-0">
        <div
          className="absolute top-1/2 left-1/2 flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            width: `${VIRTUAL_W}px`,
            height: `${VIRTUAL_H}px`,
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
              fontFamily: selectedFont || undefined,
            }}
          >
            {slide.lines.map((line, i) => (
              <div key={`${slide.id}-${i}`}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type LyricFormValues = {
  name: string;
  author: string;
  notes: string;
  font: string;
  fontSize: string;
  alignment: string[];
  markdown: string;
  globalBackground: string;
  slideBackgrounds: Record<number, string>;
};

const defaultValues: LyricFormValues = {
  name: '',
  author: '',
  notes: '',
  font: '',
  fontSize: '48px',
  alignment: ['center'],
  markdown: '',
  globalBackground: '',
  slideBackgrounds: {},
};

export const LyricModal = () => {
  const { isOpen, filePath, close } = useLyricModalStore();
  const { profiles, activeProfileId } = useProfileStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileBackground = activeProfile?.defaultBackground?.src ?? undefined;
  const editorRef = useRef<TextEditorRef | null>(null);
  const backgroundModalRef = useRef<LyricBackgroundModalRef>(null);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const { fonts } = useLocalFonts();
  const loadedPathRef = useRef<string | null>(null);

  const form = useForm({
    defaultValues,
  });

  useEffect(() => {
    if (!isOpen) {
      loadedPathRef.current = null;
      return;
    }
    if (!filePath || filePath === loadedPathRef.current) return;

    setLoadingFile(true);
    lyricService
      .load(filePath)
      .then((data) => {
        loadedPathRef.current = filePath;
        const slideBackgrounds: Record<number, string> = {};
        for (let i = 0; i < data.slides.length; i++) {
          if (data.slides[i].background) {
            slideBackgrounds[i] = data.slides[i].background!;
          }
        }

        const html = data.slides
          .map((s) => s.lines.map((l) => `<p>${l}</p>`).join(''))
          .join('<p></p>');

        form.reset();
        form.setFieldValue('name', data.metadata.name);
        form.setFieldValue('author', data.metadata.author);
        form.setFieldValue('notes', data.metadata.notes);
        form.setFieldValue('font', data.metadata.font);
        form.setFieldValue('fontSize', data.metadata.fontSize);
        form.setFieldValue('alignment', [data.metadata.alignment || 'center']);
        form.setFieldValue('globalBackground', data.metadata.globalBackground);
        form.setFieldValue('slideBackgrounds', slideBackgrounds);
        editorRef.current?.editor?.commands.setContent(html);
        const markdown = editorRef.current?.getMarkdown() ?? '';
        form.setFieldValue('markdown', markdown);
      })
      .catch((err) => {
        console.error('Failed to load lyric file:', err);
        toast.error(t('Failed to load lyric file'));
      })
      .finally(() => setLoadingFile(false));
  }, [isOpen, filePath, form.reset, form.setFieldValue]);

  const fontOptions = fonts.map((f) => ({ label: f, value: f }));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const values = form.state.values;
      const slides = parseSlides(values.markdown);
      const data: LyricData = {
        metadata: {
          name: values.name,
          author: values.author,
          notes: values.notes,
          font: values.font,
          fontSize: values.fontSize,
          alignment: values.alignment[0] || 'center',
          globalBackground: values.globalBackground,
        },
        slides: slides.map((s, i) => ({
          lines: s.lines,
          background: values.slideBackgrounds[i],
        })),
      };
      await lyricService.save(data, filePath ?? undefined);
      toast.success(t('Lyrics saved successfully.'));
      form.reset();
      editorRef.current?.setMarkdown('');
      close();
    } catch (err) {
      console.error(err);
      toast.error(t('Failed to save lyrics'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close();
      form.reset();
      editorRef.current?.setMarkdown('');
    }
  };

  return (
    <>
      <LyricBackgroundModal ref={backgroundModalRef} />
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-full sm:max-w-[90dvw] h-full max-h-[80dvh] flex"
        >
          <form.Subscribe
            selector={(s) => ({
              markdown: s.values.markdown,
              alignment: s.values.alignment,
              font: s.values.font,
              fontSize: s.values.fontSize,
              globalBackground: s.values.globalBackground,
              slideBackgrounds: s.values.slideBackgrounds,
            })}
          >
            {({
              markdown,
              alignment,
              font: selectedFont,
              fontSize,
              globalBackground,
              slideBackgrounds,
            }) => {
              const slides = parseSlides(markdown);
              const textAlign = (alignment[0] || 'center') as React.CSSProperties['textAlign'];
              const fontSizeNum = Number.parseFloat(fontSize) || 48;

              return (
                <>
                  <Card className="flex-1 p-0 gap-0 overflow-hidden">
                    <CardHeader className="p-4 flex-row items-center gap-7">
                      <h4 className="uppercase">{t('Theme Settings')}</h4>

                      <Select
                        value={selectedFont}
                        onValueChange={(val) => form.setFieldValue('font', val ?? '')}
                      >
                        <SelectTrigger className="w-full max-w-44 h-8 bg-background dark:bg-background border-0">
                          <SelectValue placeholder="Font" />
                        </SelectTrigger>
                        <SelectContent
                          className="min-w-[--anchor-width] w-auto max-w-xs"
                          align="center"
                        >
                          <SelectGroup>
                            {fontOptions.map((item) => (
                              <SelectItem
                                key={item.value}
                                value={item.value}
                                textClassName="whitespace-pre-wrap text-ellipsis line-clamp-2"
                              >
                                <span style={{ fontFamily: item.value }}>{item.label}</span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Input
                        className="max-w-24 h-8 bg-background border-0"
                        placeholder={t('Font size')}
                        value={fontSize}
                        onChange={(e) => form.setFieldValue('fontSize', e.target.value)}
                        onBlur={() => {
                          const trimmed = fontSize.trim();
                          if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
                            form.setFieldValue('fontSize', `${trimmed}px`);
                          }
                        }}
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        className={globalBackground ? 'text-primary' : ''}
                        onClick={() =>
                          backgroundModalRef.current?.open((bg) =>
                            form.setFieldValue('globalBackground', bg.src)
                          )
                        }
                      >
                        <Palette /> {t('Global Background')}
                      </Button>

                      <Toggle className="ml-auto data-[state=on]:bg-transparent aria-pressed:bg-transparent [&[aria-pressed=true]_.eye-open]:hidden [&[aria-pressed=false]_.eye-closed]:hidden">
                        <Eye className="eye-open" />
                        <EyeOff className="eye-closed" />
                        {t('Live Preview')}
                      </Toggle>
                    </CardHeader>
                    <Separator />
                    <CardContent className="flex-1 overflow-hidden p-0">
                      <ScrollArea className="size-full">
                        {slides.length === 0 ? (
                          <div className="flex items-center justify-center h-full p-6">
                            <p className="text-muted-foreground text-sm">
                              {t('Start typing in the editor to preview slides')}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-4 p-6">
                            {slides.map((slide, i) => (
                              <SlidePreview
                                key={slide.id}
                                slide={slide}
                                textAlign={textAlign}
                                selectedFont={selectedFont}
                                fontSizeNum={fontSizeNum}
                                background={slideBackgrounds[i]}
                                globalBackground={globalBackground || profileBackground}
                                onSetBackground={() =>
                                  backgroundModalRef.current?.open((bg) =>
                                    form.setFieldValue('slideBackgrounds', {
                                      ...form.state.values.slideBackgrounds,
                                      [i]: bg.src,
                                    })
                                  )
                                }
                              />
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  <Card className="flex-1 max-w-1/5 overflow-hidden">
                    <section className="flex flex-col gap-3">
                      <Label className="uppercase text-xs">{t('Text Alignment')}</Label>
                      <ToggleGroup
                        value={alignment}
                        onValueChange={(val) => form.setFieldValue('alignment', val)}
                        variant="secondary"
                        spacing={4}
                        className="gap-2 p-2 bg-background w-full justify-between"
                      >
                        <ToggleGroupItem
                          value="left"
                          aria-label="Toggle left"
                          className="flex-1 rounded-[4px]"
                        >
                          <AlignLeft />
                        </ToggleGroupItem>

                        <ToggleGroupItem
                          value="center"
                          aria-label="Toggle center"
                          className="flex-1 rounded-[4px]"
                        >
                          <AlignCenter />
                        </ToggleGroupItem>

                        <ToggleGroupItem
                          value="right"
                          aria-label="Toggle right"
                          className="flex-1 rounded-[4px]"
                        >
                          <AlignRight />
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </section>

                    <section className="flex flex-col gap-3">
                      <Label className="uppercase text-xs">{t('Metadata')}</Label>
                      <form.Field name="name">
                        {(field) => (
                          <Input
                            className="h-8 bg-background border-0"
                            placeholder={t('Name')}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                        )}
                      </form.Field>
                      <form.Field name="author">
                        {(field) => (
                          <Input
                            className="h-8 bg-background border-0"
                            placeholder={t('Author')}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                        )}
                      </form.Field>
                      <form.Field name="notes">
                        {(field) => (
                          <Input
                            className="h-8 bg-background border-0"
                            placeholder={t('Notes (Key, BPM...)')}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                        )}
                      </form.Field>
                    </section>

                    <section className="flex flex-col flex-1 gap-3 min-h-0">
                      <Label className="uppercase">{t('Lyrics Editor')}</Label>

                      <ScrollArea className="flex-1 overflow-hidden bg-background rounded-xl pb-4">
                        <TextEditor
                          ref={editorRef}
                          onChange={(md) => form.setFieldValue('markdown', md)}
                          debounce={300}
                          placeholder={t('Type your lyrics here...')}
                        />
                      </ScrollArea>

                      <p className="opacity-60">{t('Double enter creates a new slide')}</p>
                    </section>

                    <CardFooter className="flex items-center gap-3 w-full px-0 mt-auto">
                      <DialogClose
                        className="flex-1 h-auto py-2"
                        render={(props) => (
                          <Button {...props} variant="secondary">
                            {t('Cancel')}
                          </Button>
                        )}
                      />
                      <Button
                        className="flex-1 h-auto py-2"
                        disabled={saving || loadingFile}
                        onClick={handleSave}
                      >
                        {t('save')}
                      </Button>
                    </CardFooter>
                  </Card>
                </>
              );
            }}
          </form.Subscribe>
        </DialogContent>
      </Dialog>
    </>
  );
};
