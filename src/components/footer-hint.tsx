import type { ReactNode } from 'react';
import { Kbd } from './ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export function FooterHints({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={400}>
      <div className="flex items-center gap-2.5">{children}</div>
    </TooltipProvider>
  );
}

export function FooterHint({
  kbd,
  label,
  tooltip,
}: {
  kbd: ReactNode;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="flex cursor-default items-center gap-1">
          <Kbd className="flex items-center gap-0.5">{kbd}</Kbd>
          <span>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
