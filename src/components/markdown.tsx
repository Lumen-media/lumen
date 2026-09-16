import {
  type BlockNode,
  type InlineNode,
  type MarkdownDocument,
  parseMarkdown,
} from '@tanstack/markdown';
import {
  type MarkdownComponentProps,
  type MarkdownComponents,
  Markdown as TanStackMarkdown,
} from '@tanstack/markdown/react';
import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import './markdown.css';

function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw);
}

function sanitizeInline(node: InlineNode): void {
  if (node.type === 'inlineHtml') {
    node.value = sanitizeHtml(node.value);
    return;
  }
  if ('children' in node) {
    if (Array.isArray((node as { children: unknown }).children)) {
      for (const child of (node as { children: InlineNode[] }).children) sanitizeInline(child);
    }
  }
}

function sanitizeBlock(node: BlockNode): void {
  switch (node.type) {
    case 'html':
      node.value = sanitizeHtml(node.value);
      break;
    case 'blockquote':
    case 'callout':
    case 'component':
      for (const child of node.children) sanitizeBlock(child);
      break;
    case 'list':
      for (const item of node.items) {
        for (const child of item.children) sanitizeBlock(child);
      }
      break;
    case 'table':
      for (const cell of [...node.header, ...node.rows.flat()]) {
        for (const child of cell.children) sanitizeInline(child);
      }
      break;
    case 'footnotes':
      for (const item of node.items) {
        for (const child of item.children) sanitizeBlock(child);
      }
      break;
    case 'heading':
    case 'paragraph':
      for (const child of node.children) sanitizeInline(child);
      break;
    default:
      break;
  }
}

function sanitizeDocument(doc: MarkdownDocument): MarkdownDocument {
  for (const node of doc.children) sanitizeBlock(node);
  return doc;
}

const defaultComponents = {
  a: (props: MarkdownComponentProps<'a'>) => {
    const { href, children, ...rest } = props;
    const safe = /^https?:\/\//i.test(href ?? '');
    return (
      <a
        href={safe ? href : undefined}
        target="_blank"
        rel="noreferrer"
        className={cn('store-readme-link', !safe && 'cursor-not-allowed')}
        onClick={safe ? undefined : (e) => e.preventDefault()}
        {...rest}
      >
        {children}
      </a>
    );
  },
  table: (props: MarkdownComponentProps<'table'>) => (
    <table className="store-readme-table" {...props} />
  ),
  th: (props: MarkdownComponentProps<'th'>) => <th className="whitespace-normal" {...props} />,
  td: (props: MarkdownComponentProps<'td'>) => <td className="whitespace-normal" {...props} />,
  img: (props: MarkdownComponentProps<'img'>) => <img {...props} alt={props.alt ?? ''} />,
  code: (props: MarkdownComponentProps<'code'>) => (
    <code className="store-readme-code" {...props} />
  ),
} satisfies MarkdownComponents;

function Markdown({
  source,
  className,
  components,
}: {
  source: string;
  className?: string;
  components?: MarkdownComponents;
}) {
  const document = useMemo(
    () => sanitizeDocument(parseMarkdown(source, { allowHtml: true })),
    [source]
  );

  return (
    <div className={className}>
      <TanStackMarkdown components={{ ...defaultComponents, ...components }} allowHtml={true}>
        {document}
      </TanStackMarkdown>
    </div>
  );
}

export { Markdown, type MarkdownComponents };
