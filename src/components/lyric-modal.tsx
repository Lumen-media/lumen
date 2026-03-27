import { t } from 'i18next';
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, ImagePlus, Palette } from 'lucide-react';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { useLocalFonts } from '@/hooks/use-local-fonts';
import { TextEditor, type TextEditorRef } from './text-editor';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './ui/dialog';
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

type LyricModalProps = {
  children: React.ReactNode;
};

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

export const LyricModal = ({ children }: LyricModalProps) => {
  const editorRef = useRef<TextEditorRef | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [alignment, setAlignment] = useState(['center']);
  const [selectedFont, setSelectedFont] = useState('');
  const [fontSize, setFontSize] = useState('48px');
  const { fonts } = useLocalFonts();

  const slides = useMemo(() => parseSlides(markdown), [markdown]);

  const fontOptions = useMemo(() => fonts.map((f) => ({ label: f, value: f })), [fonts]);

  const textAlign = (alignment[0] || 'center') as React.CSSProperties['textAlign'];

  return (
    <Dialog>
      <DialogTrigger>{children}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="w-full sm:max-w-[90dvw] h-full max-h-[80dvh] flex"
      >
        <Card className="flex-1 p-0 gap-0 overflow-hidden">
          <CardHeader className="p-4 flex-row items-center gap-7">
            <h4 className="uppercase">Theme Settings</h4>

            <Select value={selectedFont} onValueChange={(val) => setSelectedFont(val ?? '')}>
              <SelectTrigger className="w-full max-w-44 h-8 bg-background dark:bg-background border-0">
                <SelectValue placeholder="Font" />
              </SelectTrigger>
              <SelectContent className="min-w-[--anchor-width] w-auto max-w-xs" align="center">
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
              placeholder="Font size"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
            />

            <Button variant="ghost">
              <Palette /> Global Background
            </Button>

            <Toggle className="ml-auto data-[state=on]:bg-transparent aria-pressed:bg-transparent [&[aria-pressed=true]_.eye-open]:hidden [&[aria-pressed=false]_.eye-closed]:hidden">
              <Eye className="eye-open" />
              <EyeOff className="eye-closed" />
              Live Preview
            </Toggle>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="size-full">
              {slides.length === 0 ? (
                <div className="flex items-center justify-center h-full p-6">
                  <p className="text-muted-foreground text-sm">
                    Start typing in the editor to preview slides
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 p-6">
                  {slides.map((slide) => (
                    <div
                      key={slide.id}
                      className="relative aspect-video bg-black rounded-lg flex items-center justify-center p-6 border border-border/20 overflow-hidden"
                    >
                      <span className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs font-bold rounded px-1.5 py-0.5 min-w-5 text-center z-10">
                        {slide.id}
                      </span>
                      <button
                        type="button"
                        className="absolute top-2 right-2 p-1 rounded bg-white/10 hover:bg-white/20 transition-colors z-10"
                        title="Set slide background"
                      >
                        <ImagePlus className="size-3.5 text-white" />
                      </button>
                      <div
                        className="text-white uppercase text-sm leading-relaxed w-full font-semibold"
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
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex-1 max-w-1/5">
          <section className="flex flex-col gap-3">
            <Label className="uppercase text-xs">Text Alignment</Label>
            <ToggleGroup
              value={alignment}
              onValueChange={(val) => setAlignment(val)}
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
            <Label className="uppercase text-xs">Metadata</Label>
            <Input className="h-8 bg-background border-0" placeholder="Name" />
            <Input className="h-8 bg-background border-0" placeholder="Author" />
            <Input className="h-8 bg-background border-0" placeholder="Notes (Key, BPM...)" />
          </section>

          <section className="flex flex-col flex-1 gap-3">
            <Label className="uppercase">Lyrics Editor</Label>
            <TextEditor
              ref={editorRef}
              onChange={(md) => setMarkdown(md)}
              debounce={300}
              placeholder="Type your lyrics here..."
            />
            <p className="opacity-60">Double enter creates a new slide</p>
          </section>

          <CardFooter className="flex items-center gap-3 w-full px-0 mt-auto">
            <DialogClose
              className="flex-1 h-auto py-2"
              render={(props) => (
                <Button {...props} variant="secondary">
                  Cancel
                </Button>
              )}
            />
            <Button className="flex-1 h-auto py-2 bg-cyan-500 hover:bg-cyan-600 text-white">
              {t('save')}
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
};
