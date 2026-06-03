'use client';

import { useTranslation } from '@/lib/i18n';
import { Cpu, Globe, MonitorPlay, Shield } from 'lucide-react';
import { useEffect } from 'react';

import { useAppSettingsStore } from '@/stores/app-settings-store';
import { useStreamingStore } from '@/stores/streaming-store';
import { CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';

export function AdvancedSection() {
  const { t } = useTranslation();
  const { config, status, init, updateConfig } = useStreamingStore();
  const { developerMode, setDeveloperMode } = useAppSettingsStore();

  useEffect(() => {
    init().catch(() => {});
  }, [init]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('Streaming & Performance')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('Configure desktop streaming, HTML presentation server and content protection.')}
        </p>
      </div>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 pl-4">
          <MonitorPlay className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('RTC Output')}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Preview Stream')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Enable low-cost preview stream for remote devices.')}
            </p>
          </div>
          <Switch
            checked={config.preview_enabled}
            onCheckedChange={(checked) => updateConfig({ preview_enabled: checked })}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Main Resolution')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Resolution used by the main stream.')}
            </p>
          </div>
          <Select
            value={config.main_resolution}
            onValueChange={(value) =>
              updateConfig({
                main_resolution: value as '720p' | '1080p' | '1440p' | '4K',
              })
            }
          >
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p HD</SelectItem>
              <SelectItem value="1080p">1080p FHD</SelectItem>
              <SelectItem value="1440p">1440p QHD</SelectItem>
              <SelectItem value="4K">4K UHD</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Main FPS')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Frame rate for the main stream.')}
            </p>
          </div>
          <Select
            value={String(config.main_fps)}
            onValueChange={(value) =>
              updateConfig({
                main_fps: Number(value) as 1 | 15 | 24 | 30 | 60,
              })
            }
          >
            <SelectTrigger className="w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 FPS</SelectItem>
              <SelectItem value="15">15 FPS</SelectItem>
              <SelectItem value="24">24 FPS</SelectItem>
              <SelectItem value="30">30 FPS</SelectItem>
              <SelectItem value="60">60 FPS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Hardware Encoding')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Use GPU acceleration when available.')}
            </p>
          </div>
          <Switch
            checked={config.hardware_encoding}
            onCheckedChange={(checked) => updateConfig({ hardware_encoding: checked })}
          />
        </div>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 ml-3.5">
          <Globe className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('HTML Presentation Server')}</span>
        </div>

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Enable HTML Server')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Serve slides to browsers over local network.')}
            </p>
          </div>
          <Switch
            checked={config.html_server_enabled}
            onCheckedChange={(checked) => updateConfig({ html_server_enabled: checked })}
          />
        </CardContent>

        <Separator />

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Port')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Default: 8090')}</p>
          </div>
          <Input
            type="number"
            className="w-36"
            min={1}
            max={65535}
            value={config.html_server_port}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next > 0 && next <= 65535) {
                updateConfig({ html_server_port: next });
              }
            }}
          />
        </CardContent>

        <Separator />

        <CardContent className="rounded-lg p-4 space-y-1">
          <p className="text-sm font-medium">{t('Current Status')}</p>
          <p className="text-xs text-muted-foreground">
            {status.html_active && status.html_url
              ? t('Active at {{url}}', { url: status.html_url })
              : t('Server is disabled')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('Preview: {{preview}} | Main: {{main}} | Mobile: {{mobile}}', {
              preview: status.preview_subs,
              main: status.main_subs,
              mobile: status.mobile_connected ? 'connected' : 'idle',
            })}
          </p>
        </CardContent>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 ml-3.5">
          <Shield className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Content Protection')}</span>
        </div>

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Protect DRM video')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Keep stream black when protected video is being presented.')}
            </p>
          </div>
          <Switch
            checked={config.content_protection}
            onCheckedChange={(checked) => updateConfig({ content_protection: checked })}
          />
        </CardContent>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 ml-3.5">
          <Cpu className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Runtime Notes')}</span>
        </div>

        <CardContent className="rounded-lg p-4">
          <p className="text-xs text-muted-foreground">
            {t('Streaming tracks are created on-demand and released when subscribers disconnect.')}
          </p>
        </CardContent>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Developer Mode')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Enable advanced options for module development and debugging.')}
            </p>
          </div>
          <Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
        </div>
      </CardContent>
    </div>
  );
}
