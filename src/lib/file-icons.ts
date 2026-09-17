import {
  File,
  FileText,
  Headphones,
  Image as ImageIcon,
  Music,
  Presentation,
  Video,
} from 'lucide-react';

const EXTENSION_ICONS: Record<string, typeof File> = {
  '.mp3': Headphones,
  '.wav': Headphones,
  '.ogg': Headphones,
  '.flac': Headphones,
  '.m4a': Headphones,
  '.mp4': Video,
  '.avi': Video,
  '.mov': Video,
  '.mkv': Video,
  '.webm': Video,
  '.jpg': ImageIcon,
  '.jpeg': ImageIcon,
  '.png': ImageIcon,
  '.gif': ImageIcon,
  '.webp': ImageIcon,
  '.svg': ImageIcon,
  '.txt': FileText,
  '.md': FileText,
  '.doc': FileText,
  '.docx': FileText,
  '.pdf': FileText,
  '.ppt': Presentation,
  '.pptx': Presentation,
  '.pptm': Presentation,
  '.potx': Presentation,
  '.ppsx': Presentation,
  '.odp': Presentation,
  '.key': Presentation,
  '.lrc': Music,
  '.srt': Music,
};

export function getFileIcon(extension?: string) {
  const ext = extension?.toLowerCase();
  const extWithDot = ext?.startsWith('.') ? ext : `.${ext}`;
  return EXTENSION_ICONS[extWithDot] ?? File;
}
