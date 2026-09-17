import { invoke } from '@tauri-apps/api/core';
import { dirname, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { getNoticesPath, getQuickPresentationPath } from './app-paths';
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
  autoPlay?: boolean;
  intervalSeconds?: number;
  repeat?: boolean;
  animation?: string;
}

export interface LyricSlide {
  lines: string[];
  background?: string;
}

export interface LyricData {
  metadata: LyricMetadata;
  slides: LyricSlide[];
}

export async function buildLyricSearchContent(data: LyricData): Promise<string> {
  return invoke<string>('lyric_build_search_content', { data });
}

export async function parseLyricFile(content: string): Promise<LyricData> {
  return invoke<LyricData>('lyric_parse', { content });
}

class LyricService {
  private async serialize(data: LyricData): Promise<string> {
    return invoke<string>('lyric_serialize', { data });
  }

  async save(data: LyricData, existingPath?: string): Promise<string> {
    const content = await this.serialize(data);
    const fileName = data.metadata.name
      ? `${data.metadata.name.replace(/[<>:"/\\|?*]/g, '_')}.md`
      : `lyric-${Date.now()}.md`;

    let filePath: string;

    if (existingPath && (await exists(existingPath))) {
      const existingName = existingPath.split(/[\\/]/).pop() || '';
      if (existingName !== fileName) {
        const folder = existingPath.substring(0, existingPath.length - existingName.length);
        let newPath = await join(folder, fileName);
        if (newPath !== existingPath && (await exists(newPath))) {
          let counter = 1;
          const base = fileName.replace(/\.md$/, '');
          while (await exists(newPath)) {
            newPath = await join(folder, `${base} (${counter}).md`);
            counter++;
          }
        }
        await rename(existingPath, newPath);
        await mediaDbService.deleteFile(existingPath);
        filePath = newPath;
      } else {
        filePath = existingPath;
      }
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
    const indexedContent = await buildLyricSearchContent(data);
    await mediaDbService.insertFile(
      {
        name,
        path: filePath,
        size: meta.size,
        modifiedAt: meta.mtime ?? new Date(),
        extension: 'md',
        artist: data.metadata.author || undefined,
      },
      'lyrics',
      indexedContent
    );

    return filePath;
  }

  async load(filePath: string): Promise<LyricData> {
    const content = await readTextFile(filePath);
    return parseLyricFile(content);
  }

  async loadQuick(): Promise<LyricData> {
    const filePath = await getQuickPresentationPath();
    if (!(await exists(filePath))) {
      return {
        metadata: {
          name: '',
          author: '',
          notes: '',
          font: '',
          fontSize: '48px',
          alignment: 'center',
          globalBackground: '',
        },
        slides: [],
      };
    }
    const content = await readTextFile(filePath);
    return parseLyricFile(content);
  }

  async saveQuick(data: LyricData): Promise<void> {
    const content = await this.serialize(data);
    const filePath = await getQuickPresentationPath();
    const folder = await dirname(filePath);
    if (!(await exists(folder))) {
      await mkdir(folder, { recursive: true });
    }
    await writeTextFile(filePath, content);
  }

  async loadNotices(): Promise<LyricData> {
    const filePath = await getNoticesPath();
    if (!(await exists(filePath))) {
      return {
        metadata: {
          name: '',
          author: '',
          notes: '',
          font: '',
          fontSize: '48px',
          alignment: 'center',
          globalBackground: '',
        },
        slides: [],
      };
    }
    const content = await readTextFile(filePath);
    return parseLyricFile(content);
  }

  async saveNotices(data: LyricData): Promise<void> {
    const content = await this.serialize(data);
    const filePath = await getNoticesPath();
    const folder = await dirname(filePath);
    if (!(await exists(folder))) {
      await mkdir(folder, { recursive: true });
    }
    await writeTextFile(filePath, content);
  }
}

export const lyricService = new LyricService();