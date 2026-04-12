'use client';

import { t } from 'i18next';
import { ArrowRight, Code2, FileText, Lock, RefreshCw, Shield, Sparkles } from 'lucide-react';

import { useAppVersion } from '@/hooks/use-app-version';
import { useSystemInfo } from '@/hooks/use-system-info';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Separator } from '../ui/separator';

const RESOURCES = [
  { label: 'Release Notes', icon: <FileText className="size-3.5" /> },
  { label: 'Terms of Service', icon: <Shield className="size-3.5" /> },
  { label: 'Privacy Policy', icon: <Lock className="size-3.5" /> },
  { label: 'Open Source Licenses', icon: <Code2 className="size-3.5" /> },
];

export function AboutSection() {
  const version = useAppVersion();
  const { os, arch, memory, gpu } = useSystemInfo();

  const SYSTEM_INFO = [
    { label: 'Operating System', value: os },
    { label: 'Architecture', value: arch },
    { label: 'Available Memory', value: memory },
    { label: 'Graphics Renderer', value: gpu },
    { label: 'Media Engine', value: 'Lumen Render Core 1.0' },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex-row items-center justify-between p-4 bg-background/55">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl bg-primary/15">
            <Sparkles className="size-7 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Lumen</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Version {version}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Build {__BUILD_DATE__}</span>
              <span className="rounded bg-muted px-1.5 py-0.5">Desktop App</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm">
            <RefreshCw className="size-3.5" />
            {t('Check for Updates')}
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {t('Your app is up to date')}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4 bg-background/55 gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('System Information')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('Compact desktop-friendly summary aligned like a settings details panel.')}
            </p>
          </div>
          <div className="mt-4 space-y-3.5">
            {SYSTEM_INFO.map(({ label, value }, i) => (
              <div key={label}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs text-muted-foreground">{t(label)}</span>
                  <span className="text-right text-xs font-medium">{value}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-background/55 gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('Resources')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('Quick links commonly used when checking the current build.')}
            </p>
          </div>
          <div className="mt-4 space-y-1">
            {RESOURCES.map(({ label, icon }) => (
              <Button
                key={label}
                variant="ghost"
                className="w-full justify-between px-3 py-2.5 h-auto"
              >
                <span className="flex items-center gap-2.5">
                  {icon}
                  {t(label)}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </Button>
            ))}
          </div>
          {/* <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">{t('Current Build Status')}</span>
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-400" variant="outline">
              {t('Stable')}
            </Badge>
          </div> */}
        </Card>
      </div>
    </div>
  );
}
