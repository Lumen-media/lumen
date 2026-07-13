import { BubbleMenu } from '@tiptap/react/menus';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import type { TextEditorRef } from '@/components/text-editor';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export type BubbleMenuItem = {
  children: ReactNode;
  action: () => void;
  active?: boolean;
};

type TextEditorBubbleMenuProps = Omit<ComponentProps<'div'>, 'children'> & {
  editorRef: RefObject<TextEditorRef | null>;
  items: BubbleMenuItem[];
};

function TextEditorBubbleMenu({
  editorRef,
  items,
  className,
  ...props
}: TextEditorBubbleMenuProps) {
  const editor = editorRef.current?.editor;

  if (!editor) return null;

  const pressedValues = items
    .map((item, idx) => (item.active ? String(idx) : null))
    .filter((v): v is string => v !== null);

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={150}
      className={cn(
        'flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md',
        className
      )}
      {...props}
    >
      <ToggleGroup
        className="gap-1"
        variant="secondary"
        size="sm"
        value={pressedValues}
        onValueChange={() => { }}
      >
        {items.map((item, idx) => (
          <ToggleGroupItem
            size="sm"
            className="rounded h-6 min-h-6"
            key={idx}
            value={String(idx)}
            onPressedChange={() => item.action()}
          >
            {item.children}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </BubbleMenu>
  );
}

export { TextEditorBubbleMenu };
