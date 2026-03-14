import { Command } from '@tauri-apps/plugin-shell';

export interface MediaMetadata {
  duration?: number;
  title?: string;
  artist?: string;
}

export async function extractMetadata(filePath: string): Promise<MediaMetadata> {
  try {
    const output = await Command.create('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration : stream=index',
      '-of',
      'default=noprint_wrappers=1:nokey=1:nokey=1',
      filePath,
    ]).execute();

    if (output.code === 0 && output.stdout) {
      const duration = parseFloat(output.stdout.trim());
      return {
        duration: Number.isNaN(duration) ? undefined : Math.round(duration),
      };
    }
  } catch {
    try {
      const output = await Command.create('mediainfo', [
        '--Inform=General;%Duration/1000%',
        filePath,
      ]).execute();

      if (output.code === 0 && output.stdout) {
        const duration = parseInt(output.stdout.trim(), 10);
        return {
          duration: Number.isNaN(duration) ? undefined : duration,
        };
      }
    } catch {
      return {};
    }
  }

  return {};
}
