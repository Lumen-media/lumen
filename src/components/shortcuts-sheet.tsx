'use client';

import { Fragment, useMemo } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useTranslation } from '@/lib/i18n';
import { hotkeyDisplayTokens, isMacPlatform, SHORTCUTS } from '@/lib/shortcuts';
import { useShortcutsSheetStore } from '@/stores/shortcuts-sheet-store';

function ShortcutKeys({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  const mac = isMacPlatform();
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end">
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && <span className="px-1 text-xs text-muted-foreground">{t('or')}</span>}
          <span className="flex items-center">
            {hotkeyDisplayTokens(key).map((token, j) => (
              <Fragment key={`${token}-${j}`}>
                {j > 0 &&
                  (mac ? (
                    <span className="w-1" />
                  ) : (
                    <span className="px-0.5 text-xs text-muted-foreground">+</span>
                  ))}
                <Kbd>{token}</Kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function ShortcutRow({ name, keys }: { name: string; keys: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0 truncate text-sm">{t(name)}</span>
      <ShortcutKeys keys={keys} />
    </div>
  );
}

export function ShortcutsSheet() {
  const { t } = useTranslation();
  const isOpen = useShortcutsSheetStore((s) => s.isOpen);
  const close = useShortcutsSheetStore((s) => s.close);

  const groups = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; keys: string[] }>>();
    for (const def of SHORTCUTS) {
      if (def.keys.length === 0 || def.enabled === false) continue;
      const list = map.get(def.group) ?? [];
      list.push({ id: def.id, name: def.name, keys: def.keys });
      map.set(def.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent side="right" className="gap-0 p-0">
        <SheetHeader>
          <SheetTitle>{t('Keyboard Shortcuts')}</SheetTitle>
          <SheetDescription>{t('All available keyboard shortcuts')}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          {groups.map(([group, items]) => (
            <section key={group} className="pt-4">
              <h3 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{t(group)}</h3>
              <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/60">
                {items.map((item) => (
                  <ShortcutRow key={item.id} name={item.name} keys={item.keys} />
                ))}
              </div>
            </section>
          ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}