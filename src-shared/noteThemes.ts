import type { SchemaName } from './types';

// Note themes are CSS the user wrote, living in their own vault. They cannot
// execute anything — this is stylesheet text, not script — but CSS still
// reaches further than the note it is meant to style, so a theme is compiled
// before it is applied rather than injected as-is.
//
// Scoping is done by native `@scope`, not by rewriting selectors. Chromium has
// supported it since 118 and Electron 31 ships 126. That matters for safety:
// hand-rewriting selectors means hand-parsing selector syntax, and every corner
// missed there is a rule that escapes the note. Wrapping the whole sheet in
// `@scope (.sk-note)` delegates that to the engine, and leaves this module with
// the much smaller job of removing constructs `@scope` does not constrain —
// network fetches, and boxes that position themselves against the viewport.

/** The class the reading surface carries; also the scope root for every theme. */
export const THEME_SCOPE = '.sk-note';

/** Contract version this build implements. A theme that declares none is v1. */
export const THEME_CONTRACT_VERSION = 1;

export interface ThemeRejection {
  /** 1-based line in the source the rejected construct started on. */
  line: number;
  /** The offending text, trimmed for display. */
  text: string;
  reason: string;
}

export interface CompiledTheme {
  /** Scoped stylesheet text, ready to put in a <style> element. */
  css: string;
  /** Contract version the theme declared. */
  version: number;
  /** What was removed, so the editor can tell the author rather than fail mutely. */
  rejections: ThemeRejection[];
}

/**
 * A theme name has to survive being turned into a path. Anything that could
 * climb out of the themes folder is not a name.
 */
export function isValidThemeName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (name === '.' || name === '..') return false;
  return /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name);
}

/** Vault-relative path for a theme, or null when the name is not usable. */
export function themeFilePath(name: string): string | null {
  return isValidThemeName(name) ? `themes/${name}.css` : null;
}

export interface ThemeSources {
  /** Vault-wide default, or null for Skald's built-in surface. */
  vaultTheme?: string | null;
  /** Per-schema defaults, set by the user rather than shipped. */
  schemaThemes?: Partial<Record<SchemaName, string>>;
}

/**
 * Resolution runs note → schema → vault. The first name that is actually
 * usable wins; a malformed one is skipped rather than allowed to blank out a
 * default the user did set.
 */
export function resolveThemeName(
  frontmatter: Record<string, unknown>,
  schema: SchemaName | null,
  sources: ThemeSources
): string | null {
  const fromNote = frontmatter['style'];
  const candidates = [
    typeof fromNote === 'string' ? fromNote.trim() : null,
    schema ? sources.schemaThemes?.[schema] ?? null : null,
    sources.vaultTheme ?? null,
  ];
  for (const candidate of candidates) {
    if (candidate && isValidThemeName(candidate)) return candidate;
  }
  return null;
}

/** Strip CSS comments without being fooled by `/*` inside a string. */
function stripComments(css: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        if (i + 1 < css.length) out += css[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const skipped = css.slice(i, end === -1 ? css.length : end + 2);
      // Keep the newlines so reported line numbers still line up.
      out += skipped.replace(/[^\n]/g, '');
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The version a theme declares through `--skald-theme`. */
export function parseThemeVersion(css: string): number {
  const match = stripComments(css).match(/--skald-theme\s*:\s*(\d+)/);
  if (!match) return THEME_CONTRACT_VERSION;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : THEME_CONTRACT_VERSION;
}

/**
 * A url() is allowed when it stays inside the vault. Remote URLs are rejected
 * not because they might execute — they cannot — but because a note that
 * fetches on open is a beacon that fires when you read it.
 */
function urlIsLocal(raw: string): boolean {
  const value = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!value) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('data:')) return true;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/** Every url() token in a declaration value. */
function urlsIn(value: string): string[] {
  const found: string[] = [];
  const re = /url\(\s*([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) found.push(match[1]);
  return found;
}

/** At-rules whose bodies contain further rules rather than declarations. */
const RULE_LIST_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope', 'document']);

/**
 * At-rules that register a name rather than style an element. They match no
 * element, so `@scope` would simply swallow them — a themed note would silently
 * lose its typeface. They are lifted back out to the top level instead.
 */
const HOISTED_AT_RULES = new Set(['font-face', 'keyframes', 'property']);

interface DeclarationCheck {
  ok: boolean;
  reason?: string;
}

function checkDeclaration(text: string): DeclarationCheck {
  const colon = text.indexOf(':');
  if (colon === -1) return { ok: true };
  const property = text.slice(0, colon).trim().toLowerCase();
  const value = text.slice(colon + 1).trim();

  if (property === 'position' && /^fixed$/i.test(value)) {
    return { ok: false, reason: 'position: fixed escapes the note and can cover the app' };
  }
  for (const url of urlsIn(value)) {
    if (!urlIsLocal(url)) {
      return { ok: false, reason: 'remote url() — a note that fetches on open is a tracking beacon' };
    }
  }
  if (/(^|[^a-z])javascript:/i.test(value)) {
    return { ok: false, reason: 'javascript: url' };
  }
  return { ok: true };
}

interface Frame {
  /** True when this block holds declarations rather than nested rules. */
  declarations: boolean;
}

/**
 * Compile a theme for injection: comments removed, unsafe declarations and
 * at-rules dropped, the remainder wrapped in `@scope`.
 *
 * The compiler is deliberately conservative. It understands blocks, strings and
 * parentheses, and it leaves everything it does not have a specific reason to
 * remove untouched, because `@scope` is what actually contains the sheet.
 */
export function compileTheme(source: string, scope: string = THEME_SCOPE): CompiledTheme {
  const version = parseThemeVersion(source);
  const css = stripComments(source);
  const rejections: ThemeRejection[] = [];

  let out = '';
  let hoisted = '';
  let buffer = '';
  let quote: string | null = null;
  let parens = 0;
  let line = 1;
  let bufferLine = 1;
  const stack: Frame[] = [];
  /** Stack depth at which the current hoisted at-rule began, or null. */
  let hoistFrom: number | null = null;

  const inDeclarationBlock = () => stack.length > 0 && stack[stack.length - 1].declarations;
  const emit = (text: string) => {
    if (hoistFrom === null) out += text;
    else hoisted += text;
  };
  const emitted = () => (hoistFrom === null ? out : hoisted);

  const reject = (text: string, reason: string, at: number) => {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed) rejections.push({ line: at, text: trimmed.slice(0, 120), reason });
  };

  /** Emit the pending buffer as a declaration, dropping it when unsafe. */
  const flushDeclaration = (terminator: string) => {
    const text = buffer;
    buffer = '';
    if (!text.trim()) {
      emit(terminator);
      return;
    }
    const verdict = checkDeclaration(text);
    if (verdict.ok) {
      emit(text + terminator);
      return;
    }
    reject(text, verdict.reason ?? 'not allowed', bufferLine);
    // Drop the declaration but keep the separator so the block stays valid.
    if (terminator === '}') emit(terminator);
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    if (!buffer.trim()) bufferLine = line;

    if (quote) {
      buffer += ch;
      if (ch === '\\') {
        if (i + 1 < css.length) buffer += css[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === '(') parens++;
    if (ch === ')') parens = Math.max(0, parens - 1);

    if (parens > 0) {
      buffer += ch;
      continue;
    }

    if (ch === '@' && !inDeclarationBlock() && !buffer.trim()) {
      // Read the at-rule name to decide whether it is allowed at all.
      const rest = css.slice(i);
      const name = (rest.match(/^@([a-zA-Z-]+)/)?.[1] ?? '').toLowerCase();
      if (name === 'import' || name === 'charset' || name === 'namespace') {
        // Consume the whole statement, including a block if it has one.
        let j = i;
        let depth = 0;
        let q: string | null = null;
        for (; j < css.length; j++) {
          const c = css[j];
          if (c === '\n') line++;
          if (q) {
            if (c === '\\') j++;
            else if (c === q) q = null;
            continue;
          }
          if (c === '"' || c === "'") q = c;
          else if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) break;
          } else if (c === ';' && depth === 0) break;
        }
        const reason =
          name === 'import'
            ? '@import fetches another stylesheet; inline what you need instead'
            : `@${name} has no meaning inside a scoped theme`;
        reject(css.slice(i, j + 1), reason, bufferLine);
        i = j;
        continue;
      }
    }

    if (ch === '{') {
      const prelude = buffer.trim();
      const atRule = prelude.match(/^@([a-zA-Z-]+)/)?.[1]?.toLowerCase();
      // Inside @keyframes the children are keyframe selectors, whose blocks are
      // declarations; everything else nests either rules or declarations.
      const parent = stack[stack.length - 1];
      const declarations = atRule
        ? !RULE_LIST_AT_RULES.has(atRule) && atRule !== 'keyframes'
        : parent === undefined || !parent.declarations;
      // A name-defining at-rule written at the top level starts a hoisted run.
      if (hoistFrom === null && stack.length === 0 && atRule && HOISTED_AT_RULES.has(atRule)) {
        hoistFrom = 0;
        if (hoisted && !hoisted.endsWith('\n')) hoisted += '\n';
      }
      stack.push({ declarations: atRule === 'keyframes' ? false : declarations });
      emit(buffer + ch);
      buffer = '';
      continue;
    }

    if (ch === '}') {
      if (inDeclarationBlock()) flushDeclaration('}');
      else {
        emit(buffer + ch);
        buffer = '';
      }
      if (!emitted().endsWith('}')) emit('}');
      stack.pop();
      if (hoistFrom !== null && stack.length === hoistFrom) hoistFrom = null;
      continue;
    }

    if (ch === ';' && inDeclarationBlock()) {
      flushDeclaration(';');
      continue;
    }

    buffer += ch;
  }

  emit(buffer);

  const body = out.trim();
  const names = hoisted.trim();
  const parts: string[] = [];
  if (names) parts.push(names);
  if (body) parts.push(`@scope (${scope}) {\n${body}\n}`);

  return { css: parts.join('\n\n'), version, rejections };
}
