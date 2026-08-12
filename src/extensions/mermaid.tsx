import { useEffect, useId, useMemo, useState } from 'react';
import { MERMAID_EXTENSION_MANIFEST } from '../../src-shared/extensions';
import type { RendererExtension } from './types';

export const mermaidExtension: RendererExtension = {
  manifest: MERMAID_EXTENSION_MANIFEST,
  codeFenceRenderers: [
    {
      language: 'mermaid',
      render: ({ code }) => <MermaidDiagram code={code} />,
    },
  ],
  editorInsertions: [
    {
      id: 'mermaid.diagram',
      label: '+ diagram',
      title: 'Insert a Mermaid diagram',
      menuLabel: 'Mermaid diagram',
      keywords: ['flowchart', 'sequence', 'chart'],
      placeholder: 'Idea',
      markdown: '```mermaid\nflowchart LR\n    Idea --> Build\n    Build --> Release\n```\n',
    },
  ],
};

interface RenderedDiagram {
  svg: string;
  title: string;
}

let renderQueue: Promise<unknown> = Promise.resolve();

function MermaidDiagram({ code }: { code: string }) {
  const reactId = useId();
  const id = useMemo(() => `skald-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const theme = themeSnapshot();
  const [diagram, setDiagram] = useState<RenderedDiagram | null>(null);
  const [error, setError] = useState<DiagramError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let active = true;
    setDiagram(null);
    setError(null);
    const job = async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        theme: 'base',
        themeVariables: {
          background: theme.background,
          primaryColor: theme.surface,
          primaryBorderColor: theme.border,
          primaryTextColor: theme.text,
          lineColor: theme.muted,
          secondaryColor: theme.surfaceAlt,
          tertiaryColor: theme.background,
          fontFamily: theme.font,
        },
      });
      const rendered = await mermaid.render(id, code);
      return { svg: sanitizeSvg(rendered.svg), title: diagramTitle(code) };
    };
    const queued = renderQueue.catch(() => undefined).then(job);
    renderQueue = queued;
    void queued.then(
      (result) => { if (active) setDiagram(result); },
      (reason) => { if (active) setError(describeError(reason, code)); },
    );
    return () => { active = false; };
  }, [code, id, theme.signature]);

  const act = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      setMessage(success);
      window.setTimeout(() => setMessage(null), 1800);
    } catch (reason) {
      setMessage((reason as Error)?.message || 'That export could not be completed');
    }
  };

  if (error) {
    return (
      <section className="mermaid-card mermaid-card--error" aria-label="Mermaid diagram error">
        <strong>Mermaid could not render this diagram</strong>
        <span>{error.message}{error.line ? ` · line ${error.line}` : ''}</span>
        {error.source && <code>{error.source}</code>}
        <details>
          <summary>Show Mermaid source</summary>
          <pre className="codeblock" data-lang="mermaid"><code>{code}</code></pre>
        </details>
      </section>
    );
  }

  if (!diagram) return <div className="mermaid-card mermaid-card--loading">Rendering diagram…</div>;

  return (
    <figure className="mermaid-card" aria-label={diagram.title}>
      <div className="mermaid-card__toolbar" onClick={(event) => event.stopPropagation()}>
        <span>Mermaid</span>
        <button title="Zoom out" onClick={() => setZoom((value) => Math.max(50, value - 25))}>−</button>
        <button title="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</button>
        <button title="Zoom in" onClick={() => setZoom((value) => Math.min(300, value + 25))}>+</button>
        <button onClick={() => void act(() => navigator.clipboard.writeText(diagram.svg), 'SVG copied')}>copy SVG</button>
        <button onClick={() => void act(() => downloadSvg(diagram), 'SVG saved')}>SVG</button>
        <button onClick={() => void act(() => downloadPng(diagram, theme.background), 'PNG saved')}>PNG</button>
      </div>
      <div className="mermaid-card__viewport">
        <div style={{ width: `${zoom}%` }} dangerouslySetInnerHTML={{ __html: diagram.svg }} />
      </div>
      {message && <figcaption>{message}</figcaption>}
    </figure>
  );
}

interface DiagramTheme {
  signature: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  font: string;
}

function themeSnapshot(): DiagramTheme {
  if (typeof document === 'undefined') {
    return { signature: 'ssr', background: '#111620', surface: '#161c27', surfaceAlt: '#1c2330', border: '#38465a', text: '#eaeef4', muted: '#8a95a4', font: 'sans-serif' };
  }
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const theme = {
    background: value('--bg-2', '#111620'),
    surface: value('--bg-3', '#161c27'),
    surfaceAlt: value('--bg-4', '#1c2330'),
    border: value('--line-3', '#38465a'),
    text: value('--tx-0', '#eaeef4'),
    muted: value('--tx-2', '#8a95a4'),
    font: value('--font-ui', 'sans-serif'),
  };
  return { ...theme, signature: Object.values(theme).join('|') };
}

function sanitizeSvg(raw: string): string {
  const document = new DOMParser().parseFromString(raw, 'image/svg+xml');
  document.querySelectorAll('script').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href' || name === 'src') && /^(javascript:|https?:)/.test(value))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return new XMLSerializer().serializeToString(document.documentElement);
}

interface DiagramError { message: string; line?: number; source?: string }

function describeError(reason: unknown, code: string): DiagramError {
  const value = reason as { message?: string; hash?: { loc?: { first_line?: number; line?: number } } };
  const raw = String(value?.message || reason || 'Invalid Mermaid syntax').split('\n')[0];
  const fromMessage = /line\s+(\d+)/i.exec(raw)?.[1];
  const line = value?.hash?.loc?.first_line ?? value?.hash?.loc?.line ?? (fromMessage ? Number(fromMessage) : undefined);
  return {
    message: raw.replace(/^Error:\s*/i, ''),
    ...(line ? { line, source: code.split('\n')[line - 1]?.trim() } : {}),
  };
}

function diagramTitle(code: string): string {
  const title = /^\s*%%\{init:.*?\}%%\s*\n?\s*---\s*\n\s*title:\s*(.+)$/im.exec(code)?.[1];
  return title?.trim() || 'Mermaid diagram';
}

async function downloadSvg(diagram: RenderedDiagram): Promise<void> {
  download(new Blob([diagram.svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeName(diagram.title)}.svg`);
}

async function downloadPng(diagram: RenderedDiagram, background: string): Promise<void> {
  const source = new Blob([diagram.svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const dimensions = svgDimensions(diagram.svg);
    const width = dimensions?.width || image.naturalWidth || 1;
    const height = dimensions?.height || image.naturalHeight || 1;
    const scale = Math.min(2, 4096 / Math.max(width, height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    download(blob, `${safeName(diagram.title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function svgDimensions(svg: string): { width: number; height: number } | null {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite)) return null;
  const [, , width, height] = viewBox;
  return width > 0 && height > 0 ? { width, height } : null;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
}
