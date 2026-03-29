import { join } from '@tauri-apps/api/path';
import { exists, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { fileInitService } from './file-init-service';
import { mediaDbService } from './media-db-service';

export interface LyricMetadata {
  name: string;
  author: string;
  notes: string;
  font: string;
  fontSize: string;
  alignment: string;
  globalBackground: string;
}

export interface LyricSlide {
  lines: string[];
  background?: string;
}

export interface LyricData {
  metadata: LyricMetadata;
  slides: LyricSlide[];
}

const SLIDE_BG_PREFIX = '<!-- bg:';
const SLIDE_BG_SUFFIX = '-->';

function serializeLyric(data: LyricData): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`name: ${data.metadata.name}`);
  lines.push(`author: ${data.metadata.author}`);
  lines.push(`notes: ${data.metadata.notes}`);
  lines.push(`font: ${data.metadata.font}`);
  lines.push(`fontSize: ${data.metadata.fontSize}`);
  lines.push(`alignment: ${data.metadata.alignment}`);
  if (data.metadata.globalBackground) {
    lines.push(`globalBackground: ${data.metadata.globalBackground}`);
  }
  lines.push('---');

  for (const slide of data.slides) {
    lines.push('');
    lines.push('');
    if (slide.background) {
      lines.push(`${SLIDE_BG_PREFIX} ${slide.background} ${SLIDE_BG_SUFFIX}`);
    }
    for (const line of slide.lines) {
      lines.push(line);
    }
  }

  return lines.join('\n').trim() + '\n';
}

function parseFrontmatter(content: string): { metadata: Partial<LyricMetadata>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const raw = match[1];
  const body = match[2];
  const metadata: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    metadata[key] = value;
  }

  return { metadata: metadata as Partial<LyricMetadata>, body };
}

function parseSlides(body: string): LyricSlide[] {
  const normalized = body.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  return normalized.split(/\n{3,}/).reduce<LyricSlide[]>((acc, block) => {
    const trimmed = block.trim();
    if (!trimmed) return acc;

    const lines = trimmed.split(/\n/);
    let background: string | undefined;

    if (lines[0]?.startsWith(SLIDE_BG_PREFIX)) {
      const bgLine = lines.shift()!;
      const bgMatch = bgLine.match(/<!-- bg:\s*(.*?)\s*-->/);
      if (bgMatch) background = bgMatch[1];
    }

    const contentLines = lines.filter(Boolean);
    if (contentLines.length > 0) {
      acc.push({ lines: contentLines, background });
    }

    return acc;
  }, []);
}

export function parseLyricFile(content: string): LyricData {
  const { metadata, body } = parseFrontmatter(content);
  const slides = parseSlides(body);

  return {
    metadata: {
      name: metadata.name ?? '',
      author: metadata.author ?? '',
      notes: metadata.notes ?? '',
      font: metadata.font ?? '',
      fontSize: metadata.fontSize ?? '48px',
      alignment: metadata.alignment ?? 'center',
      globalBackground: metadata.globalBackground ?? '',
    },
    slides,
  };
}

class LyricService {
  async save(data: LyricData, existingPath?: string): Promise<string> {
    const content = serializeLyric(data);
    const fileName = data.metadata.name
      ? `${data.metadata.name.replace(/[<>:"/\\|?*]/g, '_')}.md`
      : `lyric-${Date.now()}.md`;

    let filePath: string;

    if (existingPath && (await exists(existingPath))) {
      filePath = existingPath;
    } else {
      const lyricsFolder = await fileInitService.getMediaTypePath('lyrics');
      filePath = await join(lyricsFolder, fileName);

      if (await exists(filePath)) {
        let counter = 1;
        const base = fileName.replace(/\.md$/, '');
        while (await exists(filePath)) {
          filePath = await join(lyricsFolder, `${base} (${counter}).md`);
          counter++;
        }
      }
    }

    await writeTextFile(filePath, content);

    const meta = await stat(filePath);
    const name = filePath.split(/[\\/]/).pop() || fileName;
    await mediaDbService.insertFile(
      {
        name,
        path: filePath,
        size: meta.size,
        modifiedAt: meta.mtime ?? new Date(),
        extension: 'md',
        artist: data.metadata.author || undefined,
      },
      'lyrics'
    );

    return filePath;
  }

  async load(filePath: string): Promise<LyricData> {
    const content = await readTextFile(filePath);
    return parseLyricFile(content);
  }
}

export const lyricService = new LyricService();
