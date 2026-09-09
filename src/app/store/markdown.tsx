import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { ReactNode } from 'react';
import { createElement, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import './markdown.css';

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });

interface MdToken {
  type: string;
  tag: string;
  content: string;
  info: string;
  attrs: [string, string][] | null;
  children: MdToken[] | null;
}

function attr(token: MdToken, name: string): string | undefined {
  return token.attrs?.find(([key]) => key === name)?.[1];
}

function closeType(openType: string): string {
  return `${openType.slice(0, -5)}_close`;
}

function matchPair(tokens: MdToken[], openIndex: number): number {
  let depth = 1;
  const close = closeType(tokens[openIndex].type);
  for (let i = openIndex + 1; i < tokens.length; i++) {
    if (tokens[i].type === tokens[openIndex].type) {
      depth++;
    } else if (tokens[i].type === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_ATTR: ['width', 'height'] });
}

function RawHtmlDiv({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
  }, [html]);
  return <div ref={ref} />;
}

function RawHtmlInline({ html }: { html: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
  }, [html]);
  return <span ref={ref} />;
}

function renderInline(tokens: MdToken[]): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'text') {
      out.push(token.content);
    } else if (token.type === 'softbreak') {
      out.push(' ');
    } else if (token.type === 'hardbreak') {
      out.push(<br key={i} />);
    } else if (token.type === 'code_inline') {
      out.push(
        <code key={i} className="store-readme-code">
          {token.content}
        </code>
      );
    } else if (token.type === 'image') {
      out.push(
        <img
          key={i}
          src={attr(token, 'src')}
          alt={attr(token, 'alt') ?? ''}
          title={attr(token, 'title')}
        />
      );
    } else if (token.type === 'html_inline') {
      out.push(<RawHtmlInline key={i} html={token.content} />);
    } else if (token.type.endsWith('_open')) {
      const end = matchPair(tokens, i);
      const inner = renderInline(tokens.slice(i + 1, end));
      switch (token.type) {
        case 'strong_open':
          out.push(<strong key={i}>{inner}</strong>);
          break;
        case 'em_open':
          out.push(<em key={i}>{inner}</em>);
          break;
        case 's_open':
          out.push(<del key={i}>{inner}</del>);
          break;
        case 'link_open':
          out.push(
            <a
              key={i}
              href={attr(token, 'href')}
              title={attr(token, 'title')}
              target="_blank"
              rel="noreferrer"
            >
              {inner}
            </a>
          );
          break;
        default:
          out.push(<span key={i}>{inner}</span>);
      }
      i = end;
    }
  }
  return out;
}

function renderBlock(key: number, token: MdToken, inner: ReactNode): ReactNode {
  switch (token.type) {
    case 'paragraph_open':
      return <p key={key}>{inner}</p>;
    case 'heading_open':
      return createElement(token.tag, { key }, inner);
    case 'bullet_list_open':
      return <ul key={key}>{inner}</ul>;
    case 'ordered_list_open':
      return (
        <ol key={key} start={parseInt(attr(token, 'start') ?? '1', 10)}>
          {inner}
        </ol>
      );
    case 'list_item_open':
      return <li key={key}>{inner}</li>;
    case 'blockquote_open':
      return <blockquote key={key}>{inner}</blockquote>;
    case 'table_open':
      return (
        <Table key={key} className="store-readme-table">
          {inner}
        </Table>
      );
    case 'thead_open':
      return <TableHeader key={key}>{inner}</TableHeader>;
    case 'tbody_open':
      return <TableBody key={key}>{inner}</TableBody>;
    case 'tr_open':
      return <TableRow key={key}>{inner}</TableRow>;
    case 'th_open':
      return (
        <TableHead key={key} className="whitespace-normal">
          {inner}
        </TableHead>
      );
    case 'td_open':
      return (
        <TableCell key={key} className="whitespace-normal">
          {inner}
        </TableCell>
      );
    default:
      return <span key={key}>{inner}</span>;
  }
}

function renderTokens(tokens: MdToken[]): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'inline') {
      out.push(renderInline(token.children ?? []));
    } else if (token.type === 'fence' || token.type === 'code_block') {
      const lang = token.info ? token.info.split(/\s+/)[0].toLowerCase() : undefined;
      out.push(
        <pre key={i}>
          <code className={lang ? `language-${lang}` : undefined}>{token.content}</code>
        </pre>
      );
    } else if (token.type === 'hr') {
      out.push(<hr key={i} />);
    } else if (token.type === 'html_block') {
      out.push(<RawHtmlDiv key={i} html={token.content} />);
    } else if (token.type.endsWith('_open')) {
      const end = matchPair(tokens, i);
      out.push(renderBlock(i, token, renderTokens(tokens.slice(i + 1, end))));
      i = end;
    }
  }
  return out;
}

function Markdown({ source, className }: { source: string; className?: string }) {
  const deferred = useDeferredValue(source);
  const ref = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<ReactNode>(null);

  useEffect(() => {
    setNodes(renderTokens(md.parse(deferred, {}) as unknown as MdToken[]));
  }, [deferred]);

  return (
    <div ref={ref} className={className}>
      {nodes}
    </div>
  );
}

export { Markdown };
