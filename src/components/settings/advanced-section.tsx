'use client';

import { t } from 'i18next';
import { Cpu, Layers, MonitorPlay } from 'lucide-react';

import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';

export function AdvancedSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('Streaming & Performance')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t(
            'Fine-tune transmission resolutions, granular frame rates, and hardware acceleration for optimal playback.'
          )}
        </p>
      </div>

      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <MonitorPlay className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Global Transmission Quality')}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-lg overflow-hidden">
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Base Resolution')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('The master resolution for external displays and remote transmission.')}
              </p>
            </div>
            <Select defaultValue="1080p">
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4k">4K (UHD)</SelectItem>
                <SelectItem value="1440p">1440p (QHD)</SelectItem>
                <SelectItem value="1080p">1080p (FHD)</SelectItem>
                <SelectItem value="720p">720p (HD)</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Global Frame Rate Cap')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Maximum FPS allowed for the application across all outputs.')}
              </p>
            </div>
            <Select defaultValue="60">
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="120">120 FPS</SelectItem>
                <SelectItem value="60">60 FPS</SelectItem>
                <SelectItem value="30">30 FPS</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <Layers className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Content-Specific Frame Rates')}</span>
        </div>
        <div className="flex flex-col gap-2">
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Video Playback')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                {t(
                  'Target frame rate when presenting native video files. Recommended: 60 FPS for smooth playback.'
                )}
              </p>
            </div>
            <Select defaultValue="60">
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="120">120 FPS</SelectItem>
                <SelectItem value="60">60 FPS</SelectItem>
                <SelectItem value="30">30 FPS</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Text & Lyrics Render')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                {t(
                  'Frame rate for rendering dynamic text and transitions. Lowering this can save system resources.'
                )}
              </p>
            </div>
            <Select defaultValue="30">
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60 FPS</SelectItem>
                <SelectItem value="30">30 FPS</SelectItem>
                <SelectItem value="24">24 FPS</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Full Media Window Capture')}</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                {t(
                  'Capture rate when sharing the entire presentation window over network or remote connections.'
                )}
              </p>
            </div>
            <Select defaultValue="30">
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60 FPS</SelectItem>
                <SelectItem value="30">30 FPS</SelectItem>
                <SelectItem value="24">24 FPS</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </div>
      </Card>

      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <Cpu className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Hardware & Caching')}</span>
        </div>
        <div className="flex flex-col gap-2">
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Hardware Acceleration')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Use GPU for rendering complex scenes and video decoding. Highly recommended.')}
              </p>
            </div>
            <Switch defaultChecked />
          </CardContent>
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Aggressive Pre-caching')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t(
                  'Automatically load next slides and media into memory to ensure zero latency during live events.'
                )}
              </p>
            </div>
            <Switch defaultChecked />
          </CardContent>
          <CardContent variant="muted" className="flex items-center justify-between p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium">{t('Media Cache Storage')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Clear temporary files used for thumbnails and remote access buffering.')}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground">1.2 GB used</span>
              <Button variant="destructive" size="sm">
                {t('Clear Cache')}
              </Button>
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
