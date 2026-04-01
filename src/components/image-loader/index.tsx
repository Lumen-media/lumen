import { cn } from '@/lib/utils';
import './image-loader.css';

interface ImageLoaderProps {
  className?: string;
}

export function ImageLoader({ className }: ImageLoaderProps) {
  return <div className={cn('image-loader size-12', className)} />;
}
