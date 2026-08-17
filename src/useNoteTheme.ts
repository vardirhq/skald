import { useEffect, useState } from 'react';
import { api } from './api';
import {
  THEME_CONTRACT_VERSION,
  compileTheme,
  resolveThemeName,
  type ThemeRejection,
} from '../src-shared/noteThemes';
import type { SchemaName, VaultSettings } from '../src-shared/types';

// Applies the note theme for whichever note is open. One editor is mounted at a
// time, so one stylesheet is live at a time and a single <style> element is the
// whole story.

const STYLE_ID = 'sk-note-theme';

export interface NoteThemeState {
  /** The theme that resolved, or null when the note uses the built-in surface. */
  name: string | null;
  /** True when a theme was named but no such file exists. */
  missing: boolean;
  /** Contract version the theme declared. */
  version: number;
  /** What the compiler removed, so the author can be told rather than puzzled. */
  rejections: ThemeRejection[];
}

const NONE: NoteThemeState = {
  name: null,
  missing: false,
  version: THEME_CONTRACT_VERSION,
  rejections: [],
};

function styleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const element = document.createElement('style');
  element.id = STYLE_ID;
  document.head.appendChild(element);
  return element;
}

function applyCss(css: string): void {
  styleElement().textContent = css;
}

function clearCss(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/**
 * Resolve, load and apply the theme for the open note.
 *
 * `revision` exists so a theme reloads when its file changes on disk: the vault
 * watcher already covers the themes folder, so passing the vault snapshot
 * through here is enough to pick an edit up without a dedicated channel.
 */
export function useNoteTheme(
  frontmatter: Record<string, unknown>,
  schema: SchemaName | null,
  settings: VaultSettings,
  revision?: unknown
): NoteThemeState {
  const name = resolveThemeName(frontmatter, schema, {
    vaultTheme: settings.vaultTheme,
    schemaThemes: settings.schemaThemes,
  });
  const [state, setState] = useState<NoteThemeState>(NONE);

  useEffect(() => {
    if (!name) {
      clearCss();
      setState(NONE);
      return;
    }
    let cancelled = false;
    void (async () => {
      let source: string | null = null;
      try {
        source = await api.readTheme(name);
      } catch {
        source = null;
      }
      // A later note may have resolved while this read was in flight.
      if (cancelled) return;
      if (source === null) {
        clearCss();
        setState({ ...NONE, name, missing: true });
        return;
      }
      const compiled = compileTheme(source);
      applyCss(compiled.css);
      setState({
        name,
        missing: false,
        version: compiled.version,
        rejections: compiled.rejections,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [name, revision]);

  // Leaving the editor should leave no stylesheet behind.
  useEffect(() => clearCss, []);

  return state;
}
