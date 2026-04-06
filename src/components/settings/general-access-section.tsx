'use client';

import { t } from 'i18next';
import { QrCode } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

export function GeneralAccessSection() {
  const [remoteEnabled, setRemoteEnabled] = useState(true);
  const [transmissionEnabled, setTransmissionEnabled] = useState(true);

  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">{t('Connection & Control')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('Manage connected devices and presentation broadcasting settings.')}
        </p>
      </div>

      <div className="flex flex-col p-0 gap-4">
        <Card className="flex-row items-center justify-between px-4 py-4 bg-background/55 rounded-lg">
          <div>
            <p className="text-sm font-medium">{t('Enable Remote Access')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Allow other devices on the same network to connect to this session.')}
            </p>
          </div>
          <Switch defaultChecked={remoteEnabled} onCheckedChange={setRemoteEnabled} />
        </Card>

        <Card className="flex-row items-center justify-between px-4 py-4 bg-background/55 rounded-lg">
          <div>
            <p className="text-sm font-medium">{t('Enable Remote Transmission')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Broadcast the live presentation feed to connected mobile/tablet apps.')}
            </p>
          </div>
          <Switch defaultChecked={transmissionEnabled} onCheckedChange={setTransmissionEnabled} />
        </Card>
      </div>

      <Card className="p-0 gap-0 overflow-hidden bg-background/55">
        <div className="p-4">
          <div className="flex items-start gap-5">
            <div className="p-2 shrink-0 rounded-lg bg-white flex items-center justify-center">
              <QrCode className="size-20.5 text-black" />
            </div>
            <div className="flex-1 space-y-2">
              <h3>{t('Connection Password')}</h3>
              <div className="flex items-center gap-2">
                <Input className="h-8 max-w-48 bg-background" defaultValue="lumen-stage-123" />
                <Button variant="secondary" size="sm">
                  {t('Update')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Set a password for manual connection. Users can connect by scanning the QR code or entering the IP address and this password in the Remote App.'
                )}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
