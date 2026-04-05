'use client';

import {
  BookOpen,
  ChevronDown,
  ImagePlus,
  Info,
  Monitor,
  Music,
  Palette,
  QrCode,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';

type NavSection = 'theme' | 'remote_general' | 'remote_permissions' | 'advanced' | 'about';

const SECTION_TITLES: Record<NavSection, { label: string; title: string }> = {
  theme: { label: 'Application settings', title: 'Configure themes, devices and transmission' },
  remote_general: { label: 'Remote Access', title: 'General Access & Connection' },
  remote_permissions: { label: 'Remote Access', title: 'Device Permissions' },
  advanced: { label: 'Application settings', title: 'Advanced Configuration' },
  about: { label: 'Application settings', title: 'About Lumen' },
};

const PROFILES = ['Default Studio', 'Youth Night', 'Sunday Service'];

const APP_COLORS = [
  { color: 'bg-primary', label: 'Cyan' },
  { color: 'bg-emerald-400', label: 'Green' },
  { color: 'bg-violet-400', label: 'Purple' },
  { color: 'bg-amber-400', label: 'Amber' },
  { color: 'bg-rose-400', label: 'Rose' },
];

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

export const SettingsDialog = () => {
  const [activeSection, setActiveSection] = useState<NavSection>('theme');
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState('Default Studio');
  const [activeColor, setActiveColor] = useState('Cyan');

  const isRemoteSection =
    activeSection === 'remote_general' || activeSection === 'remote_permissions';

  const handleNavClick = (section: NavSection) => {
    setActiveSection(section);
    if (section === 'remote_general' || section === 'remote_permissions') {
      setRemoteOpen(true);
    } else {
      setRemoteOpen(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={<button />}>
        <Settings className="size-4 text-muted-foreground" />
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="w-full sm:max-w-[90dvw] h-full max-h-[80dvh] flex"
      >
        <Card className="w-56 shrink-0 p-0 gap-0 overflow-hidden">
          <CardHeader className="p-3 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="font-semibold text-sm">Lumen</span>
            </div>
            <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
              <span className="sr-only">Close</span>×
            </DialogClose>
          </CardHeader>

          <Separator />

          <div className="p-2">
            <div className="rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">Workspace</p>
              <p className="text-sm font-medium leading-tight mt-0.5">Default Studio Profile</p>
            </div>
          </div>

          <Separator />

          <nav className="flex flex-1 flex-col gap-0.5 p-2">
            <button
              onClick={() => handleNavClick('theme')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'theme'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Palette className="size-4" />
              Theme & Profiles
            </button>

            <div>
              <button
                onClick={() => {
                  const next = !remoteOpen;
                  setRemoteOpen(next);
                  if (next && !isRemoteSection) setActiveSection('remote_general');
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                  isRemoteSection
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Monitor className="size-4" />
                <span className="flex-1">Remote Access</span>
                <ChevronDown
                  className={cn('size-3.5 transition-transform', remoteOpen && 'rotate-180')}
                />
              </button>

              {remoteOpen && (
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-3">
                  <button
                    onClick={() => handleNavClick('remote_general')}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors text-left',
                      activeSection === 'remote_general'
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Wifi className="size-3.5" />
                    General Access
                  </button>
                  <button
                    onClick={() => handleNavClick('remote_permissions')}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors text-left',
                      activeSection === 'remote_permissions'
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Users className="size-3.5" />
                    Device Permissions
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => handleNavClick('advanced')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'advanced'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="size-4" />
              Advanced
            </button>

            <button
              onClick={() => handleNavClick('about')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeSection === 'about'
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Info className="size-4" />
              About
            </button>
          </nav>

          <Separator />

          <div className="p-3 text-xs text-muted-foreground space-y-1.5">
            <div className="flex items-center justify-between">
              <span>Remote access</span>
              <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Enabled
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Version</span>
              <span>1.4.2</span>
            </div>
          </div>
        </Card>

        <Card className="flex-1 p-0 gap-0 overflow-hidden">
          <CardHeader className="p-4 flex-row items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-primary">
                {SECTION_TITLES[activeSection].label}
              </p>
              <h2 className="text-xl font-bold leading-tight mt-0.5">
                {SECTION_TITLES[activeSection].title}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" size="sm">
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
              <Button size="sm">
                <Save className="size-3.5" />
                Save Changes
              </Button>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="size-full">
              <div className="p-4 space-y-4">
                {activeSection === 'theme' && (
                  <ThemeSection
                    activeProfile={activeProfile}
                    setActiveProfile={setActiveProfile}
                    activeColor={activeColor}
                    setActiveColor={setActiveColor}
                  />
                )}
                {activeSection === 'remote_general' && <GeneralAccessSection />}
                {activeSection === 'remote_permissions' && <DevicePermissionsSection />}
                {activeSection === 'advanced' && (
                  <PlaceholderSection
                    title="Advanced"
                    description="Advanced configuration options."
                  />
                )}
                {activeSection === 'about' && (
                  <PlaceholderSection
                    title="About"
                    description="Lumen version 1.4.2. Built for worship teams."
                  />
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

function ThemeSection({
  activeProfile,
  setActiveProfile,
  activeColor,
  setActiveColor,
}: {
  activeProfile: string;
  setActiveProfile: (p: string) => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
}) {
  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">Theme & Profiles</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose default visuals for lyrics and media states, and store them in custom profiles.
        </p>
      </div>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center">
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Active Profile
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            {PROFILES.map((profile) => (
              <button
                key={profile}
                onClick={() => setActiveProfile(profile)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  activeProfile === profile
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-transparent text-foreground hover:bg-muted'
                )}
              >
                {activeProfile === profile && <span className="size-2 rounded-full bg-primary" />}
                {profile}
              </button>
            ))}
            <button className="rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors">
              + New Profile
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center">
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Appearance Settings
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-6">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Profile Theme</p>
              <Select defaultValue="lumen-cyan">
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lumen-cyan">Lumen Cyan</SelectItem>
                  <SelectItem value="lumen-dark">Lumen Dark</SelectItem>
                  <SelectItem value="lumen-light">Lumen Light</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Accent Preset</p>
              <Select defaultValue="ocean-cyan">
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ocean-cyan">Ocean Cyan</SelectItem>
                  <SelectItem value="forest-green">Forest Green</SelectItem>
                  <SelectItem value="sunset-amber">Sunset Amber</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">App Colors</p>
              <div className="flex items-center gap-2">
                {APP_COLORS.map(({ color, label }) => (
                  <button
                    key={label}
                    onClick={() => setActiveColor(label)}
                    className={cn(
                      'size-8 rounded-full transition-all',
                      color,
                      activeColor === label
                        ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/50'
                        : 'opacity-70 hover:opacity-100'
                    )}
                    title={label}
                  />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center">
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Default Backgrounds
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="aspect-video rounded-lg overflow-hidden bg-muted border border-border">
              <div className="size-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
            </div>
            <button className="aspect-video rounded-lg border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors">
              <ImagePlus className="size-5" />
              <span className="text-xs">Add background</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function GeneralAccessSection() {
  const [remoteEnabled, setRemoteEnabled] = useState(true);
  const [transmissionEnabled, setTransmissionEnabled] = useState(true);

  return (
    <>
      <div className="mb-2">
        <h3 className="text-base font-semibold">Connection & Control</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage connected devices and presentation broadcasting settings.
        </p>
      </div>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center">
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Network
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-0 divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <p className="text-sm font-medium">Enable Remote Access</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allow other devices on the same network to connect to this session.
              </p>
            </div>
            <Switch checked={remoteEnabled} onCheckedChange={setRemoteEnabled} />
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <p className="text-sm font-medium">Enable Remote Transmission</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Broadcast the live presentation feed to connected mobile/tablet apps.
              </p>
            </div>
            <Switch checked={transmissionEnabled} onCheckedChange={setTransmissionEnabled} />
          </div>
        </CardContent>
      </Card>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center">
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Connection Password
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
          <div className="flex items-start gap-5">
            <div className="size-20 shrink-0 rounded-lg bg-white flex items-center justify-center">
              <QrCode className="size-12 text-black" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Input className="h-8 max-w-48" defaultValue="lumen-stage-123" />
                <Button variant="secondary" size="sm">
                  Update
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Users can connect by scanning the QR code or entering the IP address and this
                password in the Remote App.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

type PermissionMap = Record<string, Record<string, boolean>>;

function DevicePermissionsSection() {
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
        <h3 className="text-base font-semibold">Device Permissions</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose which features each connected device is allowed to access.
        </p>
      </div>

      <Card className="p-0 gap-0 overflow-hidden">
        <CardHeader className="p-4 flex-row items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
            Connected Devices
          </h4>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Device
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Type
                </th>
                {PERMISSION_FEATURES.map((f) => (
                  <th
                    key={f.id}
                    className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground w-20"
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CONNECTED_DEVICES.map((device) => (
                <tr key={device.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{device.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{device.type}</td>
                  {PERMISSION_FEATURES.map((f) => (
                    <td key={f.id} className="px-4 py-3 text-center">
                      <Checkbox
                        checked={permissions[device.id][f.id]}
                        onCheckedChange={() => toggle(device.id, f.id)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <Card className="p-0 gap-0 overflow-hidden">
      <CardHeader className="p-4 flex-row items-center">
        <h4 className="uppercase text-xs font-semibold tracking-widest text-muted-foreground">
          {title}
        </h4>
      </CardHeader>
      <Separator />
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
