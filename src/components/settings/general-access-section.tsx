'use client';

import { useTranslation } from '@/lib/i18n';
import { Loader2, QrCode, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import type { RegistrationTokenPayload, RemoteAccessSettings } from '@/services';
import { devicesService } from '@/services';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Switch } from '../ui/switch';

const DEFAULT_SETTINGS: RemoteAccessSettings = {
  remote_enabled: true,
  transmission_enabled: true,
};

export function GeneralAccessSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RemoteAccessSettings>(DEFAULT_SETTINGS);
  const [localIp, setLocalIp] = useState<string>('');
  const [registration, setRegistration] = useState<RegistrationTokenPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [savingKey, setSavingKey] = useState<'remote' | 'transmission' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let mounted = true;
    let unlistenAuthenticated: (() => void) | null = null;

    async function loadRemoteAccess() {
      try {
        setLoading(true);
        setError(null);
        const [remoteSettings, ip] = await Promise.all([
          devicesService.getRemoteAccessSettings(),
          devicesService.getLocalIp(),
        ]);

        if (!mounted) return;

        setSettings(remoteSettings);
        setLocalIp(ip);

        if (remoteSettings.remote_enabled) {
          const token = await devicesService.generateRegistrationToken();
          if (!mounted) return;
          setRegistration(token);
        } else {
          setRegistration(null);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : t('Unable to load remote access settings.'));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadRemoteAccess();

    devicesService
      .onDeviceAuthenticated(() => {
        if (!mounted || !settings.remote_enabled) return;
        refreshQrCode().catch(() => {});
      })
      .then((unlisten) => {
        unlistenAuthenticated = unlisten;
      });

    return () => {
      mounted = false;
      unlistenAuthenticated?.();
    };
  }, [settings.remote_enabled]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function buildQrCode() {
      if (!registration || !localIp || !settings.remote_enabled) {
        setQrDataUrl('');
        return;
      }

      const payload = JSON.stringify({
        ip: localIp,
        port: 8080,
        token: registration.token,
      });

      try {
        const nextQr = await QRCode.toDataURL(payload, {
          margin: 1,
          width: 220,
        });
        if (!cancelled) {
          setQrDataUrl(nextQr);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('Unable to generate QR code.'));
        }
      }
    }

    buildQrCode();

    return () => {
      cancelled = true;
    };
  }, [registration, localIp, settings.remote_enabled]);

  const expiresIn = useMemo(() => {
    if (!registration) return 0;
    return Math.max(0, registration.expires_at - now);
  }, [registration, now]);

  const expiryLabel = useMemo(() => {
    const minutes = Math.floor(expiresIn / 60);
    const seconds = expiresIn % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [expiresIn]);

  useEffect(() => {
    if (!settings.remote_enabled || !registration || refreshingQr || loading) {
      return;
    }

    if (expiresIn === 0) {
      refreshQrCode().catch(() => {});
    }
  }, [expiresIn, loading, refreshingQr, registration, settings.remote_enabled]);

  async function persistSettings(
    nextSettings: RemoteAccessSettings,
    key: 'remote' | 'transmission'
  ) {
    const previous = settings;
    setSettings(nextSettings);
    setSavingKey(key);
    setError(null);

    try {
      const saved = await devicesService.updateRemoteAccessSettings(nextSettings);
      setSettings(saved);

      if (key === 'remote') {
        if (saved.remote_enabled) {
          await refreshQrCode();
        } else {
          setRegistration(null);
          setQrDataUrl('');
        }
      }
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : t('Unable to save remote access settings.'));
    } finally {
      setSavingKey(null);
    }
  }

  async function refreshQrCode() {
    if (!settings.remote_enabled) return;

    try {
      setRefreshingQr(true);
      setError(null);
      const token = await devicesService.generateRegistrationToken();
      setRegistration(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Unable to refresh QR code.'));
    } finally {
      setRefreshingQr(false);
    }
  }

  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">{t('Connection & Control')}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('Manage connected devices and presentation broadcasting settings.')}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-0">
        <Card className="flex-row items-center justify-between rounded-lg bg-background/55 px-4 py-4">
          <div>
            <p className="text-sm font-medium">{t('Enable Remote Access')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(
                'Allow external devices on the same network to register and control this session. Internal app websockets remain trusted and unchanged.'
              )}
            </p>
          </div>
          <Switch
            checked={settings.remote_enabled}
            disabled={savingKey === 'remote'}
            onCheckedChange={(checked) =>
              persistSettings({ ...settings, remote_enabled: checked }, 'remote')
            }
          />
        </Card>

        <Card className="flex-row items-center justify-between rounded-lg bg-background/55 px-4 py-4">
          <div>
            <p className="text-sm font-medium">{t('Enable Remote Transmission')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('Keep live presentation broadcasting available for connected remote clients.')}
            </p>
          </div>
          <Switch
            checked={settings.transmission_enabled}
            disabled={savingKey === 'transmission'}
            onCheckedChange={(checked) =>
              persistSettings({ ...settings, transmission_enabled: checked }, 'transmission')
            }
          />
        </Card>
      </div>

      <Card className="overflow-hidden bg-background/55 p-0">
        <div className="flex flex-col gap-5 p-4 lg:flex-row lg:items-start">
          <div className="flex items-start gap-4">
            <div className="flex size-32 shrink-0 items-center justify-center rounded-xl border bg-white">
              {loading || refreshingQr ? (
                <Loader2 className="size-8 animate-spin text-black/70" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt={t('Remote access QR code')} className="size-28" />
              ) : (
                <QrCode className="size-28 text-black" />
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                {settings.remote_enabled
                  ? t('Scan this QR code in the mobile app to register a remote device.')
                  : t(
                      'Remote access is currently disabled. Enable it to generate a pairing QR code.'
                    )}
              </p>

              <div className="grid gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{t('Host')}</span>
                  <span>{localIp ? `${localIp}:8080` : '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{t('Token')}</span>
                  <span className="font-mono text-[11px]">
                    {registration?.token ?? t('Generate after enabling remote access')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{t('Expires in')}</span>
                  <span>{registration ? expiryLabel : '—'}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!settings.remote_enabled || refreshingQr || loading}
                  onClick={refreshQrCode}
                >
                  <RefreshCw className="size-3.5" />
                  {t('Refresh QR')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}
