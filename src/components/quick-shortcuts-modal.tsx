import { ArrowLeft, ChevronRight, Terminal } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandSpec } from '@/modules/types';
import { type ActiveApp, useCommandStore } from '@/stores/command-store';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command';
import { Dialog, DialogContent } from './ui/dialog';
import { Kbd } from './ui/kbd';

function CommandIcon({ spec }: { spec: CommandSpec }) {
  if (spec.icon) {
    const Icon = spec.icon;
    return <Icon className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <Terminal className="size-4 shrink-0 text-muted-foreground" />;
}

function RootView() {
  const { t } = useTranslation();
  const { commands, prefilter, close, pushApp } = useCommandStore();

  const actions = commands.filter((c) => c.type !== 'app');
  const apps = commands.filter((c) => c.type === 'app');

  function handleSelect(spec: CommandSpec) {
    if (spec.type === 'app' && spec.component) {
      pushApp({ commandId: spec.id, title: spec.title, component: spec.component } satisfies ActiveApp);
    } else {
      spec.run?.();
      close();
    }
  }

  return (
    <Command className="rounded-none">
      <CommandInput placeholder={t('Type a command or search...')} defaultValue={prefilter} autoFocus />
      <CommandList className="max-h-[320px]">
        <CommandEmpty>{t('No results found.')}</CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading={t('Commands')}>
            {actions.map((spec) => (
              <CommandItem
                key={spec.id}
                value={`${spec.title} ${spec.keywords?.join(' ') ?? ''}`}
                onSelect={() => handleSelect(spec)}
                className="gap-3 py-2"
              >
                <CommandIcon spec={spec} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{spec.title}</span>
                  {spec.subtitle && (
                    <span className="truncate text-xs text-muted-foreground">{spec.subtitle}</span>
                  )}
                </div>
                {spec.keybinding && <CommandShortcut>{spec.keybinding}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {actions.length > 0 && apps.length > 0 && <CommandSeparator />}

        {apps.length > 0 && (
          <CommandGroup heading={t('Apps')}>
            {apps.map((spec) => (
              <CommandItem
                key={spec.id}
                value={`${spec.title} ${spec.keywords?.join(' ') ?? ''}`}
                onSelect={() => handleSelect(spec)}
                className="gap-3 py-2"
              >
                <CommandIcon spec={spec} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{spec.title}</span>
                  {spec.subtitle && (
                    <span className="truncate text-xs text-muted-foreground">{spec.subtitle}</span>
                  )}
                </div>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>

      <Footer />
    </Command>
  );
}

function AppView({ app }: { app: ActiveApp }) {
  const { close, popApp } = useCommandStore();
  const AppComponent = app.component;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={popApp}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span>{app.title}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <AppComponent onClose={close} onBack={popApp} />
      </div>

      <Footer showBack />
    </div>
  );
}

function Footer({ showBack }: { showBack?: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center justify-between border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Kbd className="h-auto text-[10px]">↑↓</Kbd>
          {t('Navigate')}
        </span>
        <span className="flex items-center gap-1">
          <Kbd className="h-auto text-[10px]">↵</Kbd>
          {t('Select')}
        </span>
        {showBack && (
          <span className="flex items-center gap-1">
            <Kbd className="h-auto text-[10px]">Esc</Kbd>
            {t('Back')}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1">
        <Kbd className="h-auto text-[10px]">Esc</Kbd>
        {showBack ? t('Close') : t('Close')}
      </span>
    </div>
  );
}

export function QuickShortcutsModal() {
  const { isOpen, toggle, close, activeApp } = useCommandStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        toggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[560px]">
        {activeApp ? <AppView app={activeApp} /> : <RootView />}
      </DialogContent>
    </Dialog>
  );
}
