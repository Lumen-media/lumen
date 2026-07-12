import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  QuoteIcon,
  RedoIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
} from 'lucide-react';
import { type ComponentProps, type RefObject, useSyncExternalStore } from 'react';
import type { TextEditorRef } from '@/components/text-editor';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type TextEditorToolbarProps = ComponentProps<'div'> & {
  editorRef: RefObject<TextEditorRef | null>;
};

function useEditorState(editorRef: RefObject<TextEditorRef | null>) {
  const subscribe = (callback: () => void) => {
    const editor = editorRef.current?.editor;
    if (!editor) return () => { };
    editor.on('transaction', callback);
    editor.on('selectionUpdate', callback);
    return () => {
      editor.off('transaction', callback);
      editor.off('selectionUpdate', callback);
    };
  };

  return useSyncExternalStore(
    subscribe,
    () => editorRef.current?.editor?.state ?? null,
    () => null
  );
}

function TextEditorToolbar({ editorRef, className, ...props }: TextEditorToolbarProps) {
  useEditorState(editorRef);
  const editor = editorRef.current?.editor;

  if (!editor) return null;

  const chain = () => editor.chain().focus();

  return (
    <TooltipProvider>
      <div
        data-slot="text-editor-toolbar"
        className={cn(
          'flex flex-wrap items-center gap-0.5 border-b border-border bg-background p-1',
          className
        )}
        {...props}
      >
        {/* History */}
        <ToolbarAction
          tooltip="Undo"
          onClick={() => chain().undo().run()}
          disabled={!editor.can().undo()}
        >
          <UndoIcon />
        </ToolbarAction>
        <ToolbarAction
          tooltip="Redo"
          onClick={() => chain().redo().run()}
          disabled={!editor.can().redo()}
        >
          <RedoIcon />
        </ToolbarAction>

        <Separator orientation="vertical" className="mx-0.5 h-6" />

        {/* Headings */}
        <ToolbarToggle
          tooltip="Heading 1"
          pressed={editor.isActive('heading', { level: 1 })}
          onPressedChange={() => chain().toggleHeading({ level: 1 }).run()}
        >
          <Heading1Icon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Heading 2"
          pressed={editor.isActive('heading', { level: 2 })}
          onPressedChange={() => chain().toggleHeading({ level: 2 }).run()}
        >
          <Heading2Icon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Heading 3"
          pressed={editor.isActive('heading', { level: 3 })}
          onPressedChange={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <Heading3Icon />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-0.5 h-6" />

        {/* Inline formatting */}
        <ToolbarToggle
          tooltip="Bold"
          pressed={editor.isActive('bold')}
          onPressedChange={() => chain().toggleBold().run()}
        >
          <BoldIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Italic"
          pressed={editor.isActive('italic')}
          onPressedChange={() => chain().toggleItalic().run()}
        >
          <ItalicIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Underline"
          pressed={editor.isActive('underline')}
          onPressedChange={() => chain().toggleUnderline().run()}
        >
          <UnderlineIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Strikethrough"
          pressed={editor.isActive('strike')}
          onPressedChange={() => chain().toggleStrike().run()}
        >
          <StrikethroughIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Code"
          pressed={editor.isActive('code')}
          onPressedChange={() => chain().toggleCode().run()}
        >
          <CodeIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Highlight"
          pressed={editor.isActive('highlight')}
          onPressedChange={() => chain().toggleHighlight().run()}
        >
          <HighlighterIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Link"
          pressed={editor.isActive('link')}
          onPressedChange={() => {
            if (editor.isActive('link')) {
              chain().unsetLink().run();
              return;
            }
            const url = window.prompt('URL:');
            if (url) chain().setLink({ href: url }).run();
          }}
        >
          <LinkIcon />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-0.5 h-6" />

        {/* Text alignment */}
        <ToolbarToggle
          tooltip="Align left"
          pressed={editor.isActive({ textAlign: 'left' })}
          onPressedChange={() => chain().setTextAlign('left').run()}
        >
          <AlignLeftIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Align center"
          pressed={editor.isActive({ textAlign: 'center' })}
          onPressedChange={() => chain().setTextAlign('center').run()}
        >
          <AlignCenterIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Align right"
          pressed={editor.isActive({ textAlign: 'right' })}
          onPressedChange={() => chain().setTextAlign('right').run()}
        >
          <AlignRightIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Justify"
          pressed={editor.isActive({ textAlign: 'justify' })}
          onPressedChange={() => chain().setTextAlign('justify').run()}
        >
          <AlignJustifyIcon />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-0.5 h-6" />

        {/* Block elements */}
        <ToolbarToggle
          tooltip="Bullet list"
          pressed={editor.isActive('bulletList')}
          onPressedChange={() => chain().toggleBulletList().run()}
        >
          <ListIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Ordered list"
          pressed={editor.isActive('orderedList')}
          onPressedChange={() => chain().toggleOrderedList().run()}
        >
          <ListOrderedIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Task list"
          pressed={editor.isActive('taskList')}
          onPressedChange={() => chain().toggleTaskList().run()}
        >
          <ListTodoIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Blockquote"
          pressed={editor.isActive('blockquote')}
          onPressedChange={() => chain().toggleBlockquote().run()}
        >
          <QuoteIcon />
        </ToolbarToggle>
        <ToolbarToggle
          tooltip="Code block"
          pressed={editor.isActive('codeBlock')}
          onPressedChange={() => chain().toggleCodeBlock().run()}
        >
          <CodeIcon />
        </ToolbarToggle>
        <ToolbarAction tooltip="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>
          <MinusIcon />
        </ToolbarAction>
      </div>
    </TooltipProvider>
  );
}

function ToolbarToggle({
  tooltip,
  children,
  ...props
}: { tooltip: string } & ComponentProps<typeof Toggle>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle size="sm" variant="secondary" {...props}>
            {children}
          </Toggle>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarAction({
  tooltip,
  children,
  className,
  ...props
}: { tooltip: string } & ComponentProps<'button'>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 min-w-7 items-center justify-center rounded-[min(var(--radius-md),12px)] px-1.5 text-sm text-secondary-foreground shadow-xs transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
              className
            )}
            {...props}
          >
            {children}
          </button>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { TextEditorToolbar };
