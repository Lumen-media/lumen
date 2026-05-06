import { Copy, Minus, Plus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TitlebarControlButton } from './control-button';
import type { DesktopOsType } from './use-os-type';
import type { WindowState } from './use-window-state';

type WindowControlsProps = {
  osType: DesktopOsType;
  windowState: WindowState;
};

type MacTrafficLightProps = {
  ariaLabel: string;
  color: 'green' | 'red' | 'yellow';
  icon: typeof Minus;
  isFocused: boolean;
  onClick: () => void | Promise<void>;
};

function MacTrafficLight({ ariaLabel, color, icon: Icon, isFocused, onClick }: MacTrafficLightProps) {
  return (
    <TitlebarControlButton
      aria-label={ariaLabel}
      onClick={() => void onClick()}
      className={cn(
        'group size-3 rounded-full border border-black/10 transition-colors',
        color === 'red' && 'bg-[#ff5f57] active:bg-[#ff7b74]',
        color === 'yellow' && 'bg-[#febc2e] active:bg-[#ffc95a]',
        color === 'green' && 'bg-[#28c840] active:bg-[#45d45a]',
        !isFocused && 'border-black/5 bg-muted'
      )}
    >
      {isFocused ? <Icon className="hidden size-2.5 stroke-[2.4] text-black/65 group-hover:block" /> : null}
    </TitlebarControlButton>
  );
}

function MacOsWindowControls({ windowState }: { windowState: WindowState }) {
  const { t } = useTranslation();
  const { appWindow, isFocused, toggleFullscreen } = windowState;
  const [isAltPressed, setIsAltPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltPressed(false);
      }
    };

    const resetAlt = () => setIsAltPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', resetAlt);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', resetAlt);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 px-3">
      <MacTrafficLight
        ariaLabel={t('Close window')}
        color="red"
        icon={X}
        isFocused={isFocused}
        onClick={() => appWindow.close()}
      />
      <MacTrafficLight
        ariaLabel={t('Minimize window')}
        color="yellow"
        icon={Minus}
        isFocused={isFocused}
        onClick={() => appWindow.minimize()}
      />
      <MacTrafficLight
        ariaLabel={isAltPressed ? t('Toggle maximize window') : t('Toggle fullscreen')}
        color="green"
        icon={isAltPressed ? Plus : Square}
        isFocused={isFocused}
        onClick={() => (isAltPressed ? appWindow.toggleMaximize() : toggleFullscreen())}
      />
    </div>
  );
}

function WindowsWindowControls({ windowState }: { windowState: WindowState }) {
  const { t } = useTranslation();
  const { appWindow, isMaximized } = windowState;

  return (
    <div className="flex h-full items-stretch">
      <TitlebarControlButton
        aria-label={t('Minimize window')}
        onClick={() => void appWindow.minimize()}
        className="h-full w-[46px] text-foreground/90 transition-colors hover:bg-foreground/5 active:bg-foreground/4"
      >
        <Minus className="size-3.5" />
      </TitlebarControlButton>
      <TitlebarControlButton
        aria-label={isMaximized ? t('Restore window') : t('Maximize window')}
        onClick={() => void appWindow.toggleMaximize()}
        className="h-full w-[46px] text-foreground/90 transition-colors hover:bg-foreground/5 active:bg-foreground/4"
      >
        {isMaximized ? <Copy className="size-3 -scale-x-100" /> : <Square className="size-3" />}
      </TitlebarControlButton>
      <TitlebarControlButton
        aria-label={t('Close window')}
        onClick={() => void appWindow.close()}
        className="h-full w-[46px] text-foreground/90 transition-colors hover:bg-[#c42b1c] hover:text-white active:bg-[#a5261a] active:text-white"
      >
        <X className="size-3.5" />
      </TitlebarControlButton>
    </div>
  );
}

function LinuxWindowControls({ windowState }: { windowState: WindowState }) {
  const { t } = useTranslation();
  const { appWindow, isMaximized } = windowState;

  return (
    <div className="mr-2 flex items-center gap-1">
      <TitlebarControlButton
        aria-label={t('Minimize window')}
        onClick={() => void appWindow.minimize()}
        className="size-8 rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Minus className="size-3.5" />
      </TitlebarControlButton>
      <TitlebarControlButton
        aria-label={isMaximized ? t('Restore window') : t('Maximize window')}
        onClick={() => void appWindow.toggleMaximize()}
        className="size-8 rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {isMaximized ? <Copy className="size-3 -scale-x-100" /> : <Square className="size-3" />}
      </TitlebarControlButton>
      <TitlebarControlButton
        aria-label={t('Close window')}
        onClick={() => void appWindow.close()}
        className="size-8 rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <X className="size-3.5" />
      </TitlebarControlButton>
    </div>
  );
}

export function TitlebarWindowControls({ osType, windowState }: WindowControlsProps) {
  if (osType === 'macos') {
    return <MacOsWindowControls windowState={windowState} />;
  }

  if (osType === 'linux') {
    return <LinuxWindowControls windowState={windowState} />;
  }

  return <WindowsWindowControls windowState={windowState} />;
}
