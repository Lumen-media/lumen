import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  type ComponentProps,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
} from 'react';
import { useDebounceCallback } from 'usehooks-ts';
import { cn } from '@/lib/utils';

export type TextEditorRef = {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  getHTML: () => string;
  focus: () => void;
  editor: ReturnType<typeof useEditor> | null;
};

type TextEditorProps = Omit<ComponentProps<'div'>, 'onChange'> & {
  defaultValue?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  debounce?: number;
  editable?: boolean;
  children?: ReactNode;
};

const TextEditor = forwardRef<TextEditorRef, TextEditorProps>(
  (
    {
      className,
      defaultValue,
      placeholder,
      onChange,
      debounce = 800,
      editable = true,
      children,
      ...props
    },
    ref
  ) => {
    const debouncedOnChange = useDebounceCallback((md: string) => {
      onChange?.(md);
    }, debounce);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: { HTMLAttributes: { class: 'rounded-md bg-muted p-4 font-mono text-sm' } },
          blockquote: { HTMLAttributes: { class: 'border-l-4 border-border pl-4 italic' } },
        }),
        Markdown,
        Placeholder.configure({ placeholder: placeholder ?? 'Start writing...' }),
        Underline,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight.configure({ multicolor: false }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { class: 'text-primary underline cursor-pointer' },
        }),
        TaskList.configure({ HTMLAttributes: { 'data-type': 'taskList' } }),
        TaskItem.configure({ nested: true }),
      ],
      content: defaultValue ?? '',
      contentType: defaultValue ? 'markdown' : undefined,
      editable,
      editorProps: {
        attributes: {
          class: 'outline-none h-full',
        },
      },
      onUpdate: ({ editor }) => {
        const md = editor.markdown!.serialize(editor.state.doc.toJSON());
        debouncedOnChange(md);
      },
    });

    useEffect(() => {
      editor?.setEditable(editable);
    }, [editor, editable]);

    const getMarkdown = useCallback(() => {
      if (!editor) return '';
      return editor.markdown!.serialize(editor.state.doc.toJSON());
    }, [editor]);

    const setMarkdown = useCallback(
      (md: string) => {
        if (!editor) return;
        const parsed = editor.markdown!.parse(md);
        editor.commands.setContent(parsed);
      },
      [editor]
    );

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown,
        setMarkdown,
        getHTML: () => editor?.getHTML() ?? '',
        focus: () => editor?.commands.focus(),
        editor,
      }),
      [editor, getMarkdown, setMarkdown]
    );

    return (
      <div
        data-slot="text-editor"
        className={cn('relative size-full flex-1', className)}
        {...props}
      >
        {children}
        <EditorContent
          editor={editor}
          className="prose prose-sm dark:prose-invert max-w-none flex-1 h-full w-full size-full [&_.tiptap]:size-full [&_.tiptap]:p-4 [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-2lg [&_h3]:font-bold [&_h4]:text-lg [&_h4]:font-semibold [&_h5]:text-base [&_h5]:font-semibold [&_h6]:text-sm [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
        />
      </div>
    );
  }
);

TextEditor.displayName = 'TextEditor';

export { TextEditor };
