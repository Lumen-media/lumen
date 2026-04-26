import type { DialogRootChangeEventDetails } from '@base-ui/react/dialog';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from 'react';
import type * as React from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

type DrawerDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  modal?: React.ComponentProps<typeof Dialog>['modal'];
  onOpenChange?: (open: boolean, eventDetails?: DialogRootChangeEventDetails) => void;
  children: React.ReactNode;
};

export type DrawerDialogRef = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: (value: boolean) => void;
};

export const DrawerDialog = forwardRef<DrawerDialogRef, DrawerDialogProps>(function DrawerDialog(
  { children, open, defaultOpen, modal, onOpenChange },
  ref
) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);

  const currentOpen = isControlled ? open : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (nextOpen: boolean, details?: DialogRootChangeEventDetails) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen, details);
    },
    [isControlled, onOpenChange]
  );

  useImperativeHandle(
    ref,
    () => ({
      open: () => handleOpenChange(true),
      close: () => handleOpenChange(false),
      toggle: () => handleOpenChange(!currentOpen),
      setOpen: (value: boolean) => handleOpenChange(value),
    }),
    [currentOpen, handleOpenChange]
  );

  if (isDesktop) {
    return (
      <Dialog
        open={currentOpen}
        modal={modal}
        onOpenChange={(nextOpen, details) => handleOpenChange(nextOpen, details)}
      >
        {children}
      </Dialog>
    );
  }

  return (
    <Drawer
      open={currentOpen}
      modal={modal === undefined ? undefined : modal === 'trap-focus' ? true : modal}
      onOpenChange={(nextOpen) => handleOpenChange(nextOpen)}
    >
      {children}
    </Drawer>
  );
});

export function DrawerDialogTrigger({ asChild = true, ...props }: React.ComponentProps<typeof DrawerTrigger>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogTrigger {...props} />;
  }

  return <DrawerTrigger asChild={asChild} {...props} />;
}

type DrawerDialogContentProps = React.ComponentProps<typeof DialogContent> & {
  drawerClassName?: string;
};

export function DrawerDialogContent({
  className,
  drawerClassName,
  showCloseButton,
  style,
  ...props
}: DrawerDialogContentProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <DialogContent
        className={cn('sm:max-w-[512px]', className)}
        showCloseButton={showCloseButton}
        style={style}
        {...props}
      />
    );
  }

  const drawerStyle = typeof style === 'function' ? undefined : style;

  return (
    <DrawerContent
      className={cn('px-7', drawerClassName)}
      style={drawerStyle}
      {...(props as React.ComponentProps<typeof DrawerContent>)}
    />
  );
}

export function DrawerDialogClose(props: React.ComponentProps<typeof DialogClose>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogClose {...props} />;
  }

  return <DrawerClose {...(props as React.ComponentProps<typeof DrawerClose>)} />;
}

export function DrawerDialogPortal(props: React.ComponentProps<typeof DialogPortal>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogPortal {...props} />;
  }

  return <DrawerPortal {...(props as React.ComponentProps<typeof DrawerPortal>)} />;
}

export function DrawerDialogOverlay(props: React.ComponentProps<typeof DialogOverlay>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogOverlay {...props} />;
  }

  return <DrawerOverlay {...(props as React.ComponentProps<typeof DrawerOverlay>)} />;
}

export function DrawerDialogHeader(props: React.ComponentProps<typeof DialogHeader>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogHeader {...props} />;
  }

  return (
    <DrawerHeader
      className={cn('text-left', props.className)}
      {...(props as React.ComponentProps<typeof DrawerHeader>)}
    />
  );
}

export function DrawerDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogTitle {...props} />;
  }

  return <DrawerTitle {...(props as React.ComponentProps<typeof DrawerTitle>)} />;
}

export function DrawerDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogDescription {...props} />;
  }

  return <DrawerDescription {...(props as React.ComponentProps<typeof DrawerDescription>)} />;
}

export function DrawerDialogFooter(props: React.ComponentProps<typeof DialogFooter>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return <DialogFooter {...props} />;
  }

  return <DrawerFooter {...(props as React.ComponentProps<typeof DrawerFooter>)} />;
}

export {
  DrawerDialog as DrawerDialogRoot,
  DrawerDialogClose as DrawerDialogDismiss,
  DrawerDialogDescription as DrawerDialogBody,
  DrawerDialogFooter as DrawerDialogActions,
  DrawerDialogHeader as DrawerDialogHead,
  DrawerDialogTitle as DrawerDialogHeading,
  DrawerDialogTrigger as DrawerDialogActivator,
};
