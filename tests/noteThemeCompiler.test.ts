import { describe, expect, it } from 'vitest';
import {
  THEME_CONTRACT_VERSION,
  compileTheme,
  isValidThemeName,
  parseThemeVersion,
  resolveThemeName,
  themeFilePath,
} from '../src-shared/noteThemes';

function compile(css: string) {
  return compileTheme(css);
}

function reasons(css: string): string[] {
  return compile(css).rejections.map((r) => r.reason);
}

describe('theme names', () => {
  it('accepts ordinary names', () => {
    expect(isValidThemeName('field-journal')).toBe(true);
    expect(isValidThemeName('Quiet Reading')).toBe(true);
    expect(isValidThemeName('v2_draft')).toBe(true);
  });

  it('refuses anything that could climb out of the themes folder', () => {
    for (const name of ['../secrets', '..', '.', 'a/b', 'a\\b', '/etc/passwd', '', ' leading']) {
      expect(isValidThemeName(name), name).toBe(false);
      expect(themeFilePath(name), name).toBeNull();
    }
  });

  it('maps a valid name into the vault themes folder', () => {
    expect(themeFilePath('field-journal')).toBe('themes/field-journal.css');
  });
});

describe('theme resolution', () => {
  const sources = {
    vaultTheme: 'quiet',
    schemaThemes: { Source: 'clipping' as const },
  };

  it('prefers the note, then the schema, then the vault', () => {
    expect(resolveThemeName({ style: 'field-journal' }, 'Source', sources)).toBe('field-journal');
    expect(resolveThemeName({}, 'Source', sources)).toBe('clipping');
    expect(resolveThemeName({}, 'Note', sources)).toBe('quiet');
    expect(resolveThemeName({}, 'Note', {})).toBeNull();
  });

  it('skips a malformed name rather than blanking a working default', () => {
    expect(resolveThemeName({ style: '../escape' }, 'Note', sources)).toBe('quiet');
  });

  it('ignores a non-string style property', () => {
    expect(resolveThemeName({ style: 42 }, 'Note', sources)).toBe('quiet');
  });
});

describe('theme version', () => {
  it('reads a declared version', () => {
    expect(parseThemeVersion('.sk-note { --skald-theme: 2; }')).toBe(2);
  });

  it('defaults to the current contract when absent', () => {
    expect(parseThemeVersion('.sk-p { color: red; }')).toBe(THEME_CONTRACT_VERSION);
  });

  it('does not read a version out of a comment', () => {
    expect(parseThemeVersion('/* --skald-theme: 9 */ .sk-p { color: red; }')).toBe(
      THEME_CONTRACT_VERSION
    );
  });
});

describe('scoping', () => {
  it('wraps the sheet so selectors cannot match outside the note', () => {
    const { css } = compile('.sk-h1 { color: red; }');
    expect(css.startsWith('@scope (.sk-note) {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css).toContain('.sk-h1');
  });

  it('produces nothing for an empty theme', () => {
    expect(compile('   ').css).toBe('');
    expect(compile('/* just a note to self */').css).toBe('');
  });
});

describe('rejected constructs', () => {
  it('drops @import', () => {
    const result = compile('@import url("https://fonts.example.com/x.css");\n.sk-p { color: red; }');
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toMatch(/@import/);
    expect(result.css).not.toContain('@import');
    expect(result.css).toContain('.sk-p');
  });

  it('drops @import written without url()', () => {
    expect(reasons('@import "other.css";')).toHaveLength(1);
  });

  it('drops remote url() in any property', () => {
    expect(reasons('.sk-note { background: url(https://tracker.example/p.gif); }')).toHaveLength(1);
    expect(reasons('.sk-note { background: url(http://tracker.example/p.gif); }')).toHaveLength(1);
    expect(reasons('.sk-note { background: url(//tracker.example/p.gif); }')).toHaveLength(1);
  });

  it('keeps vault-relative and data url()', () => {
    expect(reasons('.sk-note { background: url("../img/paper.png"); }')).toEqual([]);
    expect(reasons('.sk-note { background: url(paper.png); }')).toEqual([]);
    expect(reasons('.sk-note { background: url(data:image/gif;base64,AAAA); }')).toEqual([]);
  });

  it('drops a javascript: url', () => {
    expect(reasons('.sk-p { background: url("javascript:alert(1)"); }')).toHaveLength(1);
  });

  it('drops position: fixed but keeps other positioning', () => {
    expect(reasons('.sk-figure { position: fixed; }')).toHaveLength(1);
    expect(reasons('.sk-figure { position: sticky; top: 0; }')).toEqual([]);
    expect(reasons('.sk-figure { position: absolute; }')).toEqual([]);
  });

  it('keeps the rest of a block when one declaration is dropped', () => {
    const { css } = compile('.sk-figure { color: red; position: fixed; font-size: 20px; }');
    expect(css).toContain('color: red');
    expect(css).toContain('font-size: 20px');
    expect(css).not.toContain('fixed');
  });

  it('reports the line a rejection came from', () => {
    const result = compile('.sk-p {\n  color: red;\n  position: fixed;\n}');
    expect(result.rejections[0].line).toBe(3);
  });
});

describe('parser robustness', () => {
  it('checks declarations nested inside @media', () => {
    const result = compile('@media (min-width: 40em) { .sk-p { position: fixed; color: red; } }');
    expect(result.rejections).toHaveLength(1);
    expect(result.css).toContain('@media');
    expect(result.css).toContain('color: red');
    expect(result.css).not.toContain('fixed');
  });

  it('checks declarations nested two levels deep', () => {
    const css = '@supports (display: grid) { @media screen { .sk-p { position: fixed; } } }';
    expect(reasons(css)).toHaveLength(1);
  });

  it('handles @font-face as a declaration block', () => {
    const local = '@font-face { font-family: "X"; src: url("../fonts/x.woff2"); }';
    expect(reasons(local)).toEqual([]);
    const remote = '@font-face { font-family: "X"; src: url("https://f.example/x.woff2"); }';
    expect(reasons(remote)).toHaveLength(1);
  });

  it('handles @keyframes', () => {
    const result = compile('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }');
    expect(result.rejections).toEqual([]);
    expect(result.css).toContain('@keyframes');
    expect(result.css).toContain('opacity: 1');
  });

  // @font-face and @keyframes register a name; they match no element, so a
  // theme that declared its typeface inside @scope would silently lose it.
  it('hoists name-defining at-rules out of the scope block', () => {
    const { css } = compile(
      '@font-face { font-family: "X"; src: url("../f.woff2"); }\n.sk-p { font-family: "X"; }'
    );
    const fontAt = css.indexOf('@font-face');
    const scopeAt = css.indexOf('@scope');
    expect(fontAt).toBeGreaterThanOrEqual(0);
    expect(scopeAt).toBeGreaterThanOrEqual(0);
    expect(fontAt).toBeLessThan(scopeAt);
    expect(css).toContain('.sk-p');
  });

  it('hoists @keyframes while leaving ordinary rules scoped', () => {
    const { css } = compile('@keyframes fade { to { opacity: 1; } }\n.sk-p { color: red; }');
    expect(css.indexOf('@keyframes')).toBeLessThan(css.indexOf('@scope'));
    expect(css.slice(css.indexOf('@scope'))).toContain('.sk-p');
  });

  it('still rejects a remote font inside a hoisted rule', () => {
    const result = compile('@font-face { src: url(https://f.example/x.woff2); }');
    expect(result.rejections).toHaveLength(1);
    expect(result.css).not.toContain('https://');
  });

  it('is not fooled by braces or semicolons inside strings', () => {
    const css = '.sk-p::after { content: "} ; position: fixed"; color: red; }';
    const result = compile(css);
    expect(result.rejections).toEqual([]);
    expect(result.css).toContain('color: red');
  });

  it('is not fooled by a comment marker inside a string', () => {
    const css = '.sk-p::after { content: "/* not a comment */"; color: red; }';
    const result = compile(css);
    expect(result.css).toContain('color: red');
    expect(result.css).toContain('not a comment');
  });

  it('is not fooled by a semicolon inside a url', () => {
    expect(reasons('.sk-p { background: url(data:image/gif;base64,AAA); color: red; }')).toEqual([]);
  });

  it('keeps custom properties', () => {
    const { css } = compile('.sk-note { --note-measure: 60ch; --skald-theme: 1; }');
    expect(css).toContain('--note-measure: 60ch');
  });

  it('survives an unterminated block without throwing', () => {
    expect(() => compile('.sk-p { color: red;')).not.toThrow();
  });

  it('survives an unterminated string without throwing', () => {
    expect(() => compile('.sk-p::after { content: "oops; }')).not.toThrow();
  });
});
