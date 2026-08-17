import { Fragment, type ReactNode } from 'react';
import { extractTasks } from '../src-shared/tasks';
import { parseWikilink } from '../src-shared/wikilinks';
import type { AttachmentRef } from '../src-shared/types';
import { parseDocumentTree, type DocumentNode } from '../src-shared/documentTree';
import { extensionRegistry } from './extensions/registry';

// Markdown → React, emitting exactly the DOM the design system styles.
// Markdown stays the storage format; the document tree is the runtime model.

export interface MdContext {
  /** resolve a wikilink target to a note path, or null if missing */
  resolve: (target: string) => string | null;
  openNote: (path: string) => void;
  openExternal: (url: string) => void;
  resolveAttachment: (target: string) => AttachmentRef | null;
  openAttachment: (path: string) => void;
  attachmentUrl: (path: string) => string;
  /** toggle the task on this 1-based raw file line */
  toggleTask: (line: number, done: boolean) => void;
  todayISO: string;
  /** line offset of the body within the raw file */
  lineOffset: number;
  /** Portable note properties available to extension components. */
  frontmatter: Record<string, unknown>;
}

const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+/;
const UL_LINE = /^\s*[-*+]\s+(?!\[[ xX]\]\s)/;
const OL_LINE = /^\s*\d+[.)]\s+/;

/** Render a complete Markdown body through Skald's semantic document model. */
export function renderMarkdown(body: string, ctx: MdContext): ReactNode[] {
  const document = parseDocumentTree(body);
  return document.children.map((node) => renderDocumentNode(node, ctx));
}

function renderDocumentNode(node: DocumentNode, ctx: MdContext): ReactNode {
  if (node.type === 'block') {
    return (
      <Fragment key={node.id}>
        {renderFlatMarkdown(node.raw, { ...ctx, lineOffset: ctx.lineOffset + node.startLine })}
      </Fragment>
    );
  }

  return (
    <section
      key={node.id}
      className={`sk-container sk-container--${node.kind}`}
      data-container={node.kind}
      data-skald-container="1"
    >
      <div className="sk-container__content">
        {node.children.map((child) => (
          <Fragment key={child.id}>
            {renderFlatMarkdown(child.raw, {
              ...ctx,
              lineOffset: ctx.lineOffset + child.startLine,
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

/** Render ordinary Markdown blocks. Container structure is handled above. */
function renderFlatMarkdown(body: string, ctx: MdContext): ReactNode[] {
  const lines = body.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const flushPara = (buf: string[], startLine: number) => {
    if (!buf.join(' ').trim()) return;
    const parts: ReactNode[] = [];
    let run: string[] = [];
    const flushRun = () => {
      if (!run.length) return;
      parts.push(<Fragment key={`s${startLine}-${key++}`}>{inline(run.join(' ').trim(), ctx)}</Fragment>);
      run = [];
    };
    buf.forEach((line, index) => {
      const hardBreak = index < buf.length - 1 && /( {2,}|\\)$/.test(line);
      run.push(hardBreak ? line.replace(/( {2,}|\\)$/, '') : line);
      if (hardBreak) {
        flushRun();
        parts.push(<br key={`br${startLine}-${key++}`} />);
      }
    });
    flushRun();
    out.push(
      <p key={`p${startLine}-${key++}`} className="sk-p">
        {parts}
      </p>
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^\s*```([\w-]*)/);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const language = fence[1] || '';
      const code = codeLines.join('\n');
      const renderer = language ? extensionRegistry.codeFenceRenderer(language) : undefined;
      if (renderer) {
        out.push(
          <Fragment key={`fence-ext${key++}`}>
            {renderer.render({ code, context: ctx })}
          </Fragment>
        );
        continue;
      }
      out.push(
        <pre key={`c${key++}`} className="codeblock sk-code" data-lang={fence[1] || undefined}>
          <code>{code}</code>
        </pre>
      );
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = `h-${i + 1 + ctx.lineOffset}`;
      if (level === 1) {
        out.push(
          <h1 key={`h${key++}`} id={id} className="body-h1 sk-h1">
            {inline(text, ctx)}
          </h1>
        );
      } else if (level === 2) {
        out.push(
          <h2 key={`h${key++}`} id={id} className="sk-h2">
            <span className="h2-text">{inline(text, ctx)}</span>
          </h2>
        );
      } else {
        const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6';
        out.push(
          <Tag key={`h${key++}`} id={id} className={`sk-h${level}`}>
            {inline(text, ctx)}
          </Tag>
        );
      }
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={`hr${key++}`} className="sk-rule" />);
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const calloutMatch = quoteLines[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      if (calloutMatch) {
        const label = calloutMatch[1];
        const rest = [calloutMatch[2], ...quoteLines.slice(1)].join(' ').trim();
        const component = extensionRegistry.markdownComponent(label);
        if (component) {
          out.push(
            <Fragment key={`ext${key++}`}>
              {component.render({ content: rest, context: ctx })}
            </Fragment>
          );
          continue;
        }
        out.push(
          <div key={`co${key++}`} className="editor-callout sk-callout">
            <div className="label sk-callout__label">{label}</div>
            {inline(rest, ctx)}
          </div>
        );
      } else {
        out.push(
          <blockquote key={`q${key++}`} className="sk-quote">
            {inline(quoteLines.join(' '), ctx)}
          </blockquote>
        );
      }
      continue;
    }

    if (TASK_LINE.test(line)) {
      const start = i;
      while (i < lines.length && TASK_LINE.test(lines[i])) i++;
      const chunk = lines.slice(start, i).join('\n');
      const tasks = extractTasks(chunk, start + ctx.lineOffset);
      out.push(
        <ul key={`t${key++}`} className="tasks sk-tasks">
          {tasks.map((t) => {
            const done = t.status === 'done';
            const over = !!t.due && t.due < ctx.todayISO && !done;
            return (
              <li key={t.line} className="sk-task" data-done={done}>
                <span
                  className="checkbox sk-task__box"
                  data-done={done}
                  role="checkbox"
                  aria-checked={done}
                  tabIndex={0}
                  onClick={() => ctx.toggleTask(t.line, !done)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      ctx.toggleTask(t.line, !done);
                    }
                  }}
                />
                <span className="task-label sk-task__label">{inline(t.content, ctx)}</span>
                <span className="task-meta sk-task__meta">
                  {t.status === 'working' && (
                    <span className="sk-task__status" data-status="working">working ·{' '}</span>
                  )}
                  {t.status === 'blocked' && (
                    <span className="sk-task__status" data-status="blocked">blocked ·{' '}</span>
                  )}
                  {t.due && (
                    <span className={(over ? 'due' : 'due--ok') + ' sk-task__due'} data-overdue={over}>
                      {over ? 'overdue · ' : ''}
                      {formatDue(t.due)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    if (UL_LINE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_LINE.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={`ul${key++}`} className="plain sk-list">
          {items.map((it, n) => (
            <li key={n} className="sk-list__item">{inline(it, ctx)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (OL_LINE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_LINE.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      out.push(
        <ol key={`ol${key++}`} className="plain sk-list sk-list--ordered">
          {items.map((it, n) => (
            <li key={n} className="sk-list__item">{inline(it, ctx)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const buf: string[] = [];
    const startLine = i;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[i]) &&
      !TASK_LINE.test(lines[i]) &&
      !UL_LINE.test(lines[i]) &&
      !OL_LINE.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    flushPara(buf, startLine);
  }

  return out;
}

function formatDue(due: string): string {
  const m = due.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return due;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(m[2], 10)} ${months[parseInt(m[1], 10) - 1]}`;
}

const INLINE_RE =
  /(`[^`\n]+`)|(\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/;

export function inline(text: string, ctx: MdContext): ReactNode {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = rest.match(INLINE_RE);
    if (!m || m.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    rest = rest.slice(m.index + tok.length);

    if (tok.startsWith('`')) {
      nodes.push(<code key={key++} className="sk-code-inline">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[[')) {
      const { target, display } = parseWikilink(tok.slice(2, -2));
      const path = ctx.resolve(target);
      nodes.push(
        <a
          key={key++}
          className={'wikilink sk-wikilink' + (path ? '' : ' wikilink--missing sk-wikilink--missing')}
          href="#"
          title={path ?? `No note named “${target}”`}
          onClick={(e) => {
            e.preventDefault();
            if (path) ctx.openNote(path);
          }}
        >
          {display}
        </a>
      );
    } else if (tok.startsWith('![')) {
      const lm = tok.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (!lm) {
        nodes.push(tok);
      } else {
        const ref = ctx.resolveAttachment(lm[2]);
        const canOpen = !!ref?.exists && !!ref.path;
        nodes.push(
          <span
            key={key++}
            className={'attachment-image sk-figure' + (canOpen ? '' : ' attachment--missing sk-figure--missing')}
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            onClick={() => canOpen && ctx.openAttachment(ref!.path!)}
            onKeyDown={(e) => {
              if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                ctx.openAttachment(ref!.path!);
              }
            }}
          >
            {canOpen ? (
              <img src={ctx.attachmentUrl(ref!.path!)} alt={lm[1]} loading="lazy" />
            ) : (
              <span className="attachment-image__missing">Missing image · {lm[1] || lm[2]}</span>
            )}
            {lm[1] && <span className="attachment-image__caption sk-figure__caption">{lm[1]}</span>}
          </span>
        );
      }
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key++}>{inline(tok.slice(2, -2), ctx)}</strong>);
    } else if (tok.startsWith('~~')) {
      nodes.push(<del key={key++}>{tok.slice(2, -2)}</del>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      nodes.push(<em key={key++}>{inline(tok.slice(1, -1), ctx)}</em>);
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const url = lm[2];
        const ref = ctx.resolveAttachment(url);
        if (ref) {
          const canOpen = ref.exists && !!ref.path;
          nodes.push(
            <span
              key={key++}
              className={'attachment-card sk-file' + (canOpen ? '' : ' attachment--missing')}
              role={canOpen ? 'button' : undefined}
              tabIndex={canOpen ? 0 : undefined}
              title={canOpen ? ref.path! : `Missing file: ${url}`}
              onClick={() => canOpen && ctx.openAttachment(ref.path!)}
              onKeyDown={(e) => {
                if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  ctx.openAttachment(ref.path!);
                }
              }}
            >
              <span className="attachment-card__icon sk-file__icon">{attachmentGlyph(ref)}</span>
              <span className="attachment-card__text sk-file__text">
                <strong>{lm[1]}</strong>
                <small>{canOpen ? ref.kind : 'missing file'}</small>
              </span>
            </span>
          );
        } else {
          nodes.push(
            <a
              key={key++}
              className="wikilink sk-link"
              href="#"
              title={url}
              onClick={(e) => {
                e.preventDefault();
                ctx.openExternal(url);
              }}
            >
              {lm[1]}
            </a>
          );
        }
      } else {
        nodes.push(tok);
      }
    } else {
      nodes.push(tok);
    }
  }
  return <Fragment>{nodes}</Fragment>;
}

function attachmentGlyph(ref: AttachmentRef): string {
  return { image: '▧', pdf: 'PDF', audio: '♫', video: '▶', file: '◇' }[ref.kind];
}
