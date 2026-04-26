'use client';

import { t } from 'i18next';
import { BookOpen, ImagePlus, Loader2, MonitorPlay, Music, Smartphone, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { devicesService } from '@/services';
import type { Device, DevicePermissions } from '@/services';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const PERMISSION_FEATURES: Array<{
  id: keyof DevicePermissions;
  label: string;
  icon: ReactNode;
}> = [
  { id: 'player', label: 'Player', icon: <Music className="size-3.5" /> },
  { id: 'lyrics', label: 'Lyrics', icon: <Music className="size-3.5" /> },
  { id: 'bible', label: 'Bible', icon: <BookOpen className="size-3.5" /> },
  { id: 'media', label: 'Media', icon: <ImagePlus className="size-3.5" /> },
  { id: 'streaming', label: 'Streaming', icon: <MonitorPlay className="size-3.5" /> },
];

export function DevicePermissionsSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlistenRegistered: (() => void) | null = null;
    let unlistenUpdated: (() => void) | null = null;
    let unlistenDeactivated: (() => void) | null = null;
    let unlistenRemoved: (() => void) | null = null;

    async function loadDevices() {
      try {
        setLoading(true);
        setError(null);
        const nextDevices = await devicesService.getDevices();
        if (mounted) {
          setDevices(nextDevices);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : t('Unable to load registered devices.'));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDevices();

    devicesService.onDeviceRegistered((device) => {
      setDevices((current) => {
        const withoutCurrent = current.filter((entry) => entry.device_id !== device.device_id);
        return [...withoutCurrent, device].sort((left, right) =>
          left.device_name.localeCompare(right.device_name)
        );
      });
    }).then((unlisten) => {
      unlistenRegistered = unlisten;
    });

    devicesService.onDeviceUpdated((device) => {
      setDevices((current) =>
        current
          .map((entry) => (entry.device_id === device.device_id ? device : entry))
          .sort((left, right) => left.device_name.localeCompare(right.device_name))
      );
    }).then((unlisten) => {
      unlistenUpdated = unlisten;
    });

    devicesService.onDeviceDeactivated((device) => {
      setDevices((current) =>
        current
          .map((entry) => (entry.device_id === device.device_id ? device : entry))
          .sort((left, right) => left.device_name.localeCompare(right.device_name))
      );
    }).then((unlisten) => {
      unlistenDeactivated = unlisten;
    });

    devicesService.onDeviceRemoved((deviceId) => {
      setDevices((current) => current.filter((entry) => entry.device_id !== deviceId));
    }).then((unlisten) => {
      unlistenRemoved = unlisten;
    });

    return () => {
      mounted = false;
      unlistenRegistered?.();
      unlistenUpdated?.();
      unlistenDeactivated?.();
      unlistenRemoved?.();
    };
  }, []);

  async function handleToggleActive(device: Device, isActive: boolean) {
    const busyId = `toggle:${device.device_id}`;
    const previous = devices;
    setBusyKey(busyId);
    setError(null);
    setDevices((current) =>
      current.map((entry) =>
        entry.device_id === device.device_id ? { ...entry, is_active: isActive } : entry
      )
    );

    try {
      await devicesService.toggleDevice(device.device_id, isActive);
    } catch (err) {
      setDevices(previous);
      setError(err instanceof Error ? err.message : t('Unable to update device status.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleTogglePermission(
    device: Device,
    permissionKey: keyof DevicePermissions,
    checked: boolean
  ) {
    const busyId = `permission:${device.device_id}:${permissionKey}`;
    const previous = devices;
    const nextPermissions = { ...device.permissions, [permissionKey]: checked };
    setBusyKey(busyId);
    setError(null);
    setDevices((current) =>
      current.map((entry) =>
        entry.device_id === device.device_id
          ? { ...entry, permissions: nextPermissions }
          : entry
      )
    );

    try {
      await devicesService.updateDevicePermissions(device.device_id, nextPermissions);
    } catch (err) {
      setDevices(previous);
      setError(err instanceof Error ? err.message : t('Unable to update device permissions.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemoveDevice(device: Device) {
    const busyId = `remove:${device.device_id}`;
    const previous = devices;
    setBusyKey(busyId);
    setError(null);
    setDevices((current) => current.filter((entry) => entry.device_id !== device.device_id));

    try {
      await devicesService.removeDevice(device.device_id);
    } catch (err) {
      setDevices(previous);
      setError(err instanceof Error ? err.message : t('Unable to remove device.'));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">{t('Device Permissions')}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('Choose which features each connected device is allowed to access.')}
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t('Loading devices...')}</span>
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Smartphone className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('No external devices registered yet')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('Generate a QR code in General Access and scan it from the mobile app to pair the first device.')}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-0">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('Device')}
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('Status')}
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('Last seen')}
                  </TableHead>
                  {PERMISSION_FEATURES.map((feature) => (
                    <TableHead
                      key={feature.id}
                      className="w-20 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                    >
                      {t(feature.label)}
                    </TableHead>
                  ))}
                  <TableHead className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t('Actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.device_id}>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{device.device_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {`${device.device_type} • ${device.os} • v${device.version}`}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={device.is_active}
                          disabled={busyKey === `toggle:${device.device_id}`}
                          onCheckedChange={(checked) => handleToggleActive(device, checked)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {device.is_active ? t('Allowed') : t('Blocked')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                      {formatLastSeen(device.last_connected_at)}
                    </TableCell>
                    {PERMISSION_FEATURES.map((feature) => (
                      <TableCell key={feature.id} className="px-4 py-3 text-center">
                        <Checkbox
                          checked={device.permissions[feature.id]}
                          disabled={
                            busyKey === `permission:${device.device_id}:${feature.id}` ||
                            !device.is_active
                          }
                          onCheckedChange={(checked) =>
                            handleTogglePermission(device, feature.id, checked === true)
                          }
                          aria-label={`${device.device_name} ${feature.label}`}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busyKey === `remove:${device.device_id}`}
                        onClick={() => handleRemoveDevice(device)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

function formatLastSeen(timestamp?: number | null) {
  if (!timestamp) {
    return t('Never');
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp * 1000);
}
