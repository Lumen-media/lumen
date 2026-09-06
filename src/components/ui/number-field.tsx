'use client';

import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const NumberField = NumberFieldPrimitive.Root;

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      data-slot="number-field-group"
      className={cn(className)}
      {...props}
    />
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        'h-full w-16 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        className
      )}
      {...props}
    />
  );
}

function NumberFieldDecrement({
  className,
  children,
  ...props
}: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      data-slot="number-field-decrement"
      className={cn(
        'flex h-1/2 w-5 items-center justify-center text-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:hover:bg-transparent disabled:opacity-30',
        className
      )}
      {...props}
    >
      {children ?? <ChevronDownIcon className="size-3" />}
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldIncrement({
  className,
  children,
  ...props
}: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      data-slot="number-field-increment"
      className={cn(
        'flex h-1/2 w-5 items-center justify-center text-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:hover:bg-transparent disabled:opacity-30',
        className
      )}
      {...props}
    >
      {children ?? <ChevronUpIcon className="size-3" />}
    </NumberFieldPrimitive.Increment>
  );
}

function NumberFieldScrubArea({ className, ...props }: NumberFieldPrimitive.ScrubArea.Props) {
  return (
    <NumberFieldPrimitive.ScrubArea
      data-slot="number-field-scrub-area"
      className={cn('cursor-ew-resize select-none', className)}
      {...props}
    />
  );
}

function NumberFieldScrubAreaCursor({
  className,
  ...props
}: NumberFieldPrimitive.ScrubAreaCursor.Props) {
  return (
    <NumberFieldPrimitive.ScrubAreaCursor
      data-slot="number-field-scrub-area-cursor"
      className={cn(className)}
      {...props}
    />
  );
}

export {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldScrubArea,
  NumberFieldScrubAreaCursor,
};
