import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getNotesPath } from './app-paths';

class NotesService {
  async loadNotes(profileId: string): Promise<string> {
    const filePath = await this.#getFilePath(profileId);
    if (!(await exists(filePath))) return '';
    return readTextFile(filePath);
  }

  async saveNotes(profileId: string, content: string): Promise<void> {
    const dir = await getNotesPath();
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    const filePath = await join(dir, `${profileId}.md`);
    await writeTextFile(filePath, content);
  }

  async #getFilePath(profileId: string): Promise<string> {
    const dir = await getNotesPath();
    return join(dir, `${profileId}.md`);
  }
}

export const notesService = new NotesService();
