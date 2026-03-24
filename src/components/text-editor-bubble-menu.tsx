import { BubbleMenu } from '@tiptap/react/menus';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import type { TextEditorRef } from '@/components/text-editor';
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
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          onClick={item.action}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted',
            item.active && 'bg-muted text-foreground'
          )}
        >
          {item.children}
        </button>
      ))}
    </BubbleMenu>
  );
}

export { TextEditorBubbleMenu };
