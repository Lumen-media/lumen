'use client';

import { t } from 'i18next';
import { BookOpen, ImagePlus, Music } from 'lucide-react';
import { useState } from 'react';

import { Card } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const PERMISSION_FEATURES = [
  { id: 'player', label: 'Player', icon: <Music className="size-3.5" /> },
  { id: 'lyrics', label: 'Lyrics', icon: <Music className="size-3.5" /> },
  { id: 'bible', label: 'Bible', icon: <BookOpen className="size-3.5" /> },
  { id: 'media', label: 'Media', icon: <ImagePlus className="size-3.5" /> },
];

const CONNECTED_DEVICES = [
  { id: 'd1', name: "João's iPhone", type: 'Mobile' },
  { id: 'd2', name: 'Stage iPad', type: 'Tablet' },
  { id: 'd3', name: 'Músico Tablet', type: 'Tablet' },
  { id: 'd4', name: 'Sala de Som', type: 'Desktop' },
];

type PermissionMap = Record<string, Record<string, boolean>>;

export function DevicePermissionsSection() {
  const [permissions, setPermissions] = useState<PermissionMap>(() =>
    Object.fromEntries(
      CONNECTED_DEVICES.map((d) => [
        d.id,
        Object.fromEntries(PERMISSION_FEATURES.map((f) => [f.id, true])),
      ])
    )
  );

  const toggle = (deviceId: string, featureId: string) =>
    setPermissions((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [featureId]: !prev[deviceId][featureId] },
    }));

  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">{t('Device Permissions')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('Choose which features each connected device is allowed to access.')}
        </p>
      </div>

      <Card className="p-0 gap-0 overflow-hidden">
        <div className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('Device')}
                </TableHead>
                <TableHead className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {t('Type')}
                </TableHead>
                {PERMISSION_FEATURES.map((f) => (
                  <TableHead
                    key={f.id}
                    className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground w-20"
                  >
                    {t(f.label)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CONNECTED_DEVICES.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="px-4 py-3 font-medium">{device.name}</TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {t(device.type)}
                  </TableCell>
                  {PERMISSION_FEATURES.map((f) => (
                    <TableCell key={f.id} className="px-4 py-3 text-center">
                      <Checkbox
                        checked={permissions[device.id][f.id]}
                        onCheckedChange={() => toggle(device.id, f.id)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
