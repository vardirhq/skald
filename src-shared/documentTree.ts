export type MarkdownBlockKind =
  | 'blank'
  | 'heading'
  | 'code'
  | 'quote'
  | 'task'
  | 'list'
  | 'rule'
  | 'paragraph';

export type SemanticContainerKind = 'aside' | 'gallery' | 'group';

export interface SourceRange {
  /** Zero-based inclusive source line. */
  startLine: number;
  /** Zero-based inclusive source line. */
  endLine: number;
}

export interface MarkdownBlockNode extends SourceRange {
  type: 'block';
  id: string;
  kind: MarkdownBlockKind;
  raw: string;
  parentContainerId?: string;
  parentContainerKind?: SemanticContainerKind;
}

export interface SemanticContainerNode extends SourceRange {
  type: 'container';
  id: string;
  kind: SemanticContainerKind;
  raw: string;
  children: MarkdownBlockNode[];
}

export type DocumentNode = MarkdownBlockNode | SemanticContainerNode;

export interface DocumentDiagnostic extends SourceRange {
  code: 'unclosed-container' | 'nested-container';
  message: string;
}

export interface MarkdownDocument {
  type: 'document';
  source: string;
  children: DocumentNode[];
  diagnostics: DocumentDiagnostic[];
}

export interface EditableMarkdownBlock extends MarkdownBlockNode {
  container?: {
    id: string;
    kind: SemanticContainerKind;
    startLine: number;
    endLine: number;
  };
}

const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+/;
const UL_LINE = /^\s*[-*+]\s+(?!\[[ xX]\]\s)/;
const OL_LINE = /^\s*\d+[.)]\s+/;
const HR_LINE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const CONTAINER_OPEN = /^\s*:::(aside|gallery|group)\s*$/;
const CONTAINER_CLOSE = /^\s*:::\s*$/;

/**
 * Parse Skald-flavoured Markdown into the runtime document tree.
 *
 * Markdown remains canonical. This tree is deliberately source-aware and
 * lossless: every node retains its original Markdown and source line range.
 * V1 semantic containers may contain ordinary Markdown blocks, but not other
 * semantic containers.
 */
export function parseDocumentTree(source: string): MarkdownDocument {
  const lines = source.length === 0 ? [''] : source.split('\n');
  const children: DocumentNode[] = [];
  const diagnostics: DocumentDiagnostic[] = [];
  let i = 0;

  while (i < lines.length) {
    const opener = CONTAINER_OPEN.exec(lines[i]);
    if (!opener) {
      const parsed = parseFlatBlock(lines, i);
      children.push(parsed.node);
      i = parsed.next;
      continue;
    }

    const start = i;
    const kind = opener[1] as SemanticContainerKind;
    let end = i + 1;
    while (end < lines.length && !CONTAINER_CLOSE.test(lines[end])) end++;

    if (end >= lines.length) {
      diagnostics.push({
        code: 'unclosed-container',
        startLine: start,
        endLine: lines.length - 1,
        message: `The :::${kind} container opened on line ${start + 1} has no closing ::: fence.`,
      });
      const parsed = parseFlatBlock(lines, i);
      children.push(parsed.node);
      i = parsed.next;
      continue;
    }

    const nestedLine = lines.slice(start + 1, end).findIndex((line) => CONTAINER_OPEN.test(line));
    if (nestedLine >= 0) {
      diagnostics.push({
        code: 'nested-container',
        startLine: start + 1 + nestedLine,
        endLine: start + 1 + nestedLine,
        message: 'Semantic containers cannot be nested in the v1 document model.',
      });
    }

    const inner = lines.slice(start + 1, end);
    const containerId = `c${start}-${end}-${kind}`;
    const blockChildren = parseFlatRange(inner, start + 1).map((node) => ({
      ...node,
      parentContainerId: containerId,
      parentContainerKind: kind,
    }));

    children.push({
      type: 'container',
      id: containerId,
      kind,
      startLine: start,
      endLine: end,
      raw: lines.slice(start, end + 1).join('\n'),
      children: blockChildren,
    });
    i = end + 1;
  }

  return { type: 'document', source, children, diagnostics };
}

/** Return ordinary editable blocks while retaining their semantic parent. */
export function flattenEditableBlocks(document: MarkdownDocument): EditableMarkdownBlock[] {
  return document.children.flatMap((node) => {
    if (node.type === 'block') return [node];
    return node.children.map((child) => ({
      ...child,
      container: {
        id: node.id,
        kind: node.kind,
        startLine: node.startLine,
        endLine: node.endLine,
      },
    }));
  });
}

/** Serialize the runtime tree back to Skald Markdown. */
export function serializeDocumentTree(document: MarkdownDocument): string {
  return document.children.map(serializeNode).join('\n');
}

export function serializeNode(node: DocumentNode): string {
  if (node.type === 'block') return node.raw;
  return [`:::${node.kind}`, ...node.children.map((child) => child.raw), ':::'].join('\n');
}

export function isSemanticContainerKind(value: string): value is SemanticContainerKind {
  return value === 'aside' || value === 'gallery' || value === 'group';
}

function parseFlatRange(lines: string[], sourceOffset: number): MarkdownBlockNode[] {
  if (lines.length === 0) return [];
  const result: MarkdownBlockNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const parsed = parseFlatBlock(lines, i, sourceOffset);
    result.push(parsed.node);
    i = parsed.next;
  }
  return result;
}

function parseFlatBlock(
  lines: string[],
  index: number,
  sourceOffset = 0
): { node: MarkdownBlockNode; next: number } {
  let i = index;
  const line = lines[i] ?? '';
  let kind: MarkdownBlockKind;
  let end = i;

  if (!line.trim()) {
    kind = 'blank';
    while (end + 1 < lines.length && !lines[end + 1].trim()) end++;
  } else if (/^\s*```/.test(line)) {
    kind = 'code';
    end++;
    while (end < lines.length && !/^\s*```/.test(lines[end])) end++;
    if (end >= lines.length) end = lines.length - 1;
  } else if (/^(#{1,6})\s+/.test(line)) {
    kind = 'heading';
  } else if (HR_LINE.test(line)) {
    kind = 'rule';
  } else if (/^\s*>/.test(line)) {
    kind = 'quote';
    while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1])) end++;
  } else if (TASK_LINE.test(line)) {
    kind = 'task';
    while (end + 1 < lines.length && TASK_LINE.test(lines[end + 1])) end++;
  } else if (UL_LINE.test(line) || OL_LINE.test(line)) {
    kind = 'list';
    const matcher = UL_LINE.test(line) ? UL_LINE : OL_LINE;
    while (end + 1 < lines.length && matcher.test(lines[end + 1])) end++;
  } else {
    kind = 'paragraph';
    while (
      end + 1 < lines.length &&
      lines[end + 1].trim() &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[end + 1]) &&
      !CONTAINER_OPEN.test(lines[end + 1]) &&
      !CONTAINER_CLOSE.test(lines[end + 1]) &&
      !TASK_LINE.test(lines[end + 1]) &&
      !UL_LINE.test(lines[end + 1]) &&
      !OL_LINE.test(lines[end + 1]) &&
      !HR_LINE.test(lines[end + 1])
    ) {
      end++;
    }
  }

  const startLine = index + sourceOffset;
  const endLine = end + sourceOffset;
  return {
    node: {
      type: 'block',
      id: `b${startLine}-${endLine}`,
      kind,
      startLine,
      endLine,
      raw: lines.slice(index, end + 1).join('\n'),
    },
    next: end + 1,
  };
}
