'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { animate } from 'animejs';
import { cva, type VariantProps } from 'class-variance-authority';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
        'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className
      )}
      {...props}
    />
  );
}

function TabsIndicator({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let observedElements = new Set<Element>();

    const update = () => {
      const list = el.parentElement;
      if (!list) return;

      const active = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]');
      if (!active) return;

      const anchor = el.offsetParent instanceof HTMLElement ? el.offsetParent : list;
      const anchorRect = anchor.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const left = activeRect.left - anchorRect.left;
      const width = activeRect.width;

      if (!readyRef.current) {
        animationRef.current?.cancel();
        el.style.opacity = '1';
        el.style.left = `${left}px`;
        el.style.width = `${width}px`;
        readyRef.current = true;
        return;
      }

      animationRef.current?.cancel();
      animationRef.current = animate(el, {
        left: `${left}px`,
        width: `${width}px`,
        opacity: 1,
        duration: 250,
        ease: 'outCubic',
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    const resizeObserver = new ResizeObserver(() => scheduleUpdate());

    const observeLayoutElements = () => {
      const list = el.parentElement;
      if (!list) return;

      const nextObserved = new Set<Element>([list]);
      if (el.offsetParent) nextObserved.add(el.offsetParent);

      list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]').forEach((trigger) => {
        nextObserved.add(trigger);
      });

      observedElements.forEach((element) => {
        if (!nextObserved.has(element)) resizeObserver.unobserve(element);
      });

      nextObserved.forEach((element) => {
        if (!observedElements.has(element)) resizeObserver.observe(element);
      });

      observedElements = nextObserved;
    };

    observeLayoutElements();
    scheduleUpdate();

    const observer = new MutationObserver(() => {
      observeLayoutElements();
      scheduleUpdate();
    });
    const list = el.parentElement;
    if (list) {
      observer.observe(list, {
        childList: true,
        subtree: true,
        attributeFilter: ['data-active'],
      });
    }

    return () => {
      cancelAnimationFrame(frame);
      animationRef.current?.cancel();
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      className={cn('absolute bottom-0 h-0.5 rounded-full', className)}
      style={{
        opacity: 0,
        left: 0,
        width: 0,
      }}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator, tabsListVariants };
