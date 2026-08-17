# Note themes

A design proposal. The renderer groundwork is in place — the `sk-` class contract is emitted
today — but theme files are not loaded yet, so nothing in a vault changes appearance.

Skald renders Markdown into a fixed reading surface. A note theme lets the person who owns the
vault restyle that surface: a plain CSS file, written by them, living in their vault, applied to
one note, one schema, or everything.

The storage format does not change. Markdown stays the file on disk, the block editor keeps
splitting on lines, tasks keep their line identity, and search keeps indexing prose. A theme
only decides how the rendered result looks.

## Where a theme lives

Themes are ordinary files in the vault, not in `.skald/`:

```
Vault/
  themes/
    field-journal.css
    quiet.css
  Sources/
    Mechanical watches.md
```

`.skald/` is deletable app state by design — the README promises the Markdown survives without
it. A theme is the user's writing, so it belongs beside the notes: it survives deleting Skald,
syncs as an ordinary file, and can be handed to someone else by sending them the file.

A note names its theme in frontmatter:

```yaml
---
type: Source
style: field-journal
---
```

Resolution runs note → schema → vault. A note's `style:` wins; otherwise the note's schema
default applies; otherwise the vault default; otherwise Skald's built-in surface. Schema and
vault defaults are set by the user, never shipped by Skald — the app does not decide what a
`Person` note should look like.

The schema and vault defaults themselves are stored in Skald settings, not in a vault file. They
are preferences of the same kind as the surface theme and density, which already live there, and
one string per schema does not justify inventing a file format and a parser for it. The
distinction that matters is the one `.skald/` already draws: theme *files* are the user's
writing and belong in the vault, while the *mapping* is app state. Losing the mapping loses a
preference — every note still renders, on the default surface — whereas losing the themes would
lose work.

An unknown or missing `style:` falls back to the default surface silently, the same rule the
extension registry already applies to unknown components. A theme that cannot be found is never
a broken note.

## The contract is versioned

The moment a theme targets a class name, that name is a public API. This is the failure mode
that froze MySpace profiles: customization was written against the site's own markup, so the
markup could never change.

So Skald publishes a deliberate skin — prefixed classes emitted *in addition to* the existing
internal ones. Internal names (`body-h1`, `editor-callout`, `h2-text`) stay private and
refactorable. Only the `sk-` surface is promised.

Every theme declares the contract version it was written against, as a custom property on the
scope root:

```css
.sk-note { --skald-theme: 1; }
```

A leading `/* skald-theme: 1 */` comment reads more naturally, but it has to be string-matched
before the CSS is parsed, and comments are the first thing a minifier or an unfamiliar formatter
throws away. A custom property is inside the language: it survives any CSS-aware tooling and can
be read back through the CSSOM after the sheet is loaded. A theme that declares nothing is
treated as version 1.

When the contract changes incompatibly, v1 themes keep rendering under v1 rules. A note written
in 2026 does not break because the renderer improved in 2028.

## Tier 1 — tokens

Most people should never write a selector. Tokens are scoped to the note surface and inherit
from the app tokens in `src/styles/tokens.css`, so a theme that sets nothing looks exactly like
Skald does today, in every theme and density.

```css
/* skald-theme: 1 */
.sk-note {
  --note-font-body:    "Newsreader", Georgia, serif;
  --note-font-heading: var(--font-ui);
  --note-measure:      68ch;
  --note-space-block:  1.1em;
  --note-accent:       var(--sy-orange);
}
```

Defined in `src/styles/tokens.css` and consumed by the reading surface. Each default is the
value the rule previously hard-coded, so the surface renders identically until a theme says
otherwise.

| Token | Default | Controls |
| --- | --- | --- |
| `--note-font-body` | `var(--font-ui)` | Body and list text |
| `--note-font-heading` | `var(--font-ui)` | Headings |
| `--note-font-mono` | `var(--font-mono)` | Code, task meta, callout labels |
| `--note-size-body` | `15px` | Base body size |
| `--note-line-height` | `1.72` | Body leading |
| `--note-measure` | `none` | Content column width |
| `--note-space-block` | `18px` | Space below paragraphs and lists |
| `--note-space-section` | `34px` | Space above a section heading |
| `--note-bg` | `transparent` | Surface behind the note |
| `--note-tx` | `var(--tx-1)` | Body text |
| `--note-tx-muted` | `var(--tx-2)` | Quotes, meta, the `h2` kicker |
| `--note-tx-heading` | `var(--tx-0)` | Heading text |
| `--note-accent` | `var(--ac)` | List markers, callout label, `h2` prefix |
| `--note-rule` | `var(--line)` | `<hr>` |
| `--note-radius` | `var(--r-3)` | Code blocks and callouts |
| `--note-code-bg` | `var(--bg-1)` | Code surface, block and inline |
| `--note-quote-border` | `var(--ac)` | Blockquote edge |
| `--note-link` | `var(--ac)` | Resolved links |
| `--note-link-missing` | `var(--err)` | Unresolved wikilinks |
| `--note-task-working` | `var(--sy-blue)` | `@status(working)` marker |
| `--note-task-blocked` | `var(--err)` | `@status(blocked)` marker |
| `--note-task-overdue` | `var(--warn)` | Past-due marker |

Tokens referencing app tokens is deliberate: a theme that only changes `--note-font-body` still
follows Midnight, Slate, and Daybreak correctly, and still respects the density setting.

There is no `--note-scale`. A heading-ratio token implies the sizes are generated from it, and
they are not — the surface uses hand-set sizes. Shipping a token that silently does nothing is
worse than not having one.

## Tier 2 — the class contract

Version 1 promises these names, and `src/markdown.tsx` emits all of them today. The third column
is the internal class each one sits beside — private, and free to change.

**Container**

| Class | Element | Internal companion |
| --- | --- | --- |
| `.sk-note` | reading surface | `.editor-body`, in both read and live mode |

**Blocks**

| Class | Element | Internal companion |
| --- | --- | --- |
| `.sk-p` | `<p>` | — |
| `.sk-h1` | `<h1>` | `.body-h1` |
| `.sk-h2` | `<h2>` | — (inner `.h2-text` span is private) |
| `.sk-h3` … `.sk-h6` | `<h3>` … `<h6>` | — |
| `.sk-quote` | `<blockquote>` | — |
| `.sk-callout` | `<div>` | `.editor-callout` |
| `.sk-callout__label` | `<div>` | `.label` |
| `.sk-code` | `<pre>` | `.codeblock`, plus `data-lang` |
| `.sk-rule` | `<hr>` | — |
| `.sk-list` | `<ul>`, `<ol>` | `.plain` |
| `.sk-list--ordered` | `<ol>` | `.plain` |
| `.sk-list__item` | `<li>` | — |

**Tasks**

| Class | Element | Internal companion |
| --- | --- | --- |
| `.sk-tasks` | `<ul>` | `.tasks` |
| `.sk-task` | `<li>` | —, plus `data-done` |
| `.sk-task__box` | `<span>` | `.checkbox`, plus `data-done` |
| `.sk-task__label` | `<span>` | `.task-label` |
| `.sk-task__meta` | `<span>` | `.task-meta` |
| `.sk-task__status` | `<span>` | —, plus `data-status` |
| `.sk-task__due` | `<span>` | `.due` / `.due--ok`, plus `data-overdue` |

**Inline**

| Class | Element | Internal companion |
| --- | --- | --- |
| `.sk-wikilink` | `<a>` | `.wikilink` |
| `.sk-wikilink--missing` | `<a>` | `.wikilink--missing` |
| `.sk-link` | `<a>` | `.wikilink` — outbound links, styled alike for now |
| `.sk-code-inline` | `<code>` | — |
| `.sk-figure` | `<span>` | `.attachment-image` |
| `.sk-figure__caption` | `<span>` | `.attachment-image__caption` |
| `.sk-figure--missing` | `<span>` | `.attachment--missing` |
| `.sk-file` | `<span>` | `.attachment-card` |
| `.sk-file__icon` | `<span>` | `.attachment-card__icon` |
| `.sk-file__text` | `<span>` | `.attachment-card__text` |

`tests/noteThemes.test.ts` pins these names. A rename that breaks someone's theme should fail
there first.

`<strong>`, `<em>`, `<del>`, `<br>`, and `<img>` carry no class and are targeted by tag. The
`data-done`, `data-lang`, `data-status`, `data-overdue`, and `data-schema` attributes are part
of the contract and can be selected on.

## Renderer groundwork

Five things blocked the contract. All are now fixed, and every one of them was a latent problem
in the renderer regardless of whether themes ever ship.

**No wrapper element.** `renderMarkdown` returns a bare array of nodes, and in live mode it runs
once *per block* (`Editor.tsx:1348`), so the renderer is the wrong place to emit a container. But
`.editor-body` already is the note surface in both paths, so `.sk-note` joins it there rather
than introducing a node — no new DOM, no layout change.

**`h2` wrapped its text in a presentational span.** The `.h2-text` span is an implementation
detail of the current heading treatment; the public class now sits on the `<h2>` itself, leaving
the span private and removable.

**`h4`–`h6` silently became `<h3>`.** Fixed: each level keeps its own tag. The deciding evidence
was in the stylesheet — `app.css` already styled `h3, h4` together, anticipating an `h4` the
renderer never emitted. That makes the collapse an accident rather than a considered reading
experience, and it cost heading fidelity in the DOM and its anchors quite apart from themes.
`h5` and `h6` joined that rule so the surface stays coherent.

**External links were indistinguishable from wikilinks.** An outbound `[text](url)` carried the
same `wikilink` class as `[[Note]]`. It still shares the internal class, so nothing looks
different today, but `.sk-link` now makes the two separable by a theme.

**Task status colours were inline styles.** `style={{ color: 'var(--sy-blue)' }}` outranks every
rule a theme could write short of `!important`. Status is now `.sk-task__status[data-status]`,
coloured from the stylesheet.

Several internal names are generic enough to be hazardous as public API — `.label` inside a
callout, `.plain` on lists, and `.checkbox`, which base.css shares with the margin panel.
Emitting the `sk-` names alongside them rather than renaming is what keeps the app's own
stylesheet free to change.

## Scoping and safety

No scripts are involved: a theme is CSS, loaded from the user's own vault, and cannot execute.
That is the whole reason this is a smaller feature than embedding HTML in notes.

It still needs boundaries, because CSS can reach further than the note. `compileTheme` in
`src-shared/noteThemes.ts` applies them, and `tests/noteThemeCompiler.test.ts` covers it:

- The sheet is wrapped in `@scope (.sk-note)` — native in the Chromium Electron 31 ships. This
  is deliberately not done by rewriting selectors: rewriting means hand-parsing selector syntax,
  and every corner missed there is a rule that escapes the note. Delegating to the engine also
  handles `html`, `body` and `:root` for free, since none of them is inside the scope root.
- `@import` is dropped. It fetches another stylesheet, which is both a remote load and a way
  around everything else here.
- `url()` must stay in the vault. Relative paths and `data:` are kept; anything with a scheme or
  a protocol-relative `//` is dropped. A note that fetches on open is a beacon that fires when
  you read it.
- `position: fixed` is dropped, since a fixed box escapes the scope visually even though its
  selector cannot.
- `@font-face`, `@keyframes` and `@property` are lifted back out of the `@scope` block. They
  register a name rather than match an element, so leaving them inside would silently cost a
  theme its typeface. Their names are global, so two themes open in different tabs share a
  namespace — worth knowing before naming a font `Body`.

Nothing is removed silently: every drop is returned as a rejection carrying the source line, the
offending text, and why, so the theme editor can show the author what happened instead of
leaving them to wonder why one rule does nothing.
- A **Reset this note's theme** command is always available and cannot be overridden by a
  theme. MySpace was fun because expression was unbounded and painful because pages became
  unreadable; one guaranteed escape is enough insurance.

One consequence of `.sk-note` living on `.editor-body` is that in live mode the scope root also
contains the editing furniture — `.live-block` and its textarea. Some inheritance there is
desirable, since a raw block should plausibly carry the note's body font, but a theme must not be
able to make the block being edited unusable. Those internal classes are outside the contract,
and the loader should re-assert the essentials for `.live-block__textarea` after the theme so
editing survives any stylesheet. This is the one place where a theme can reach something that is
not the note.

## Fonts

The first thing anyone will want is their own typeface. Font files live in the vault like any
other attachment, and `@font-face` resolves vault-relative sources through the existing
attachment machinery (`MdContext.attachmentUrl`):

```css
@font-face {
  font-family: "Newsreader";
  src: url("../fonts/Newsreader.woff2") format("woff2");
}
```

Remote font URLs stay blocked, for the reason above.

## The theme editor

The pane itself fits `SettingsPaneContribution` (`src/extensions/types.ts:43`), which already
exists. What makes it worth building is live preview against the note currently open, not a
synthetic sample — instant visible feedback was the actual appeal of MySpace customization, not
the CSS.

Controls write to the real `.css` file in the vault. Someone who never opens the file gets
sliders; someone who opens it finds legible CSS variables; someone who wants more writes
selectors against the contract. All three edit the same artifact, which is also why sharing is
free: a theme is one file, so people can send each other themes.

## Deliberately outside the contract

Extension-rendered DOM — Mermaid's SVG, GitHub cards — belongs to those extensions and is
versioned with them, not here. So does the frontmatter property chrome, the backlinks margin,
the outline, and every part of the editor that is not the rendered note.

## Still open

- Loading. `compileTheme` and `resolveThemeName` are done and tested; reading the file from the
  vault, applying the compiled sheet, and reacting when it changes on disk is the next piece.
  The vault watcher already covers `themes/`, so change events come for free.
- Settings. `vaultTheme` and `schemaThemes` need to join `VaultSettings`, alongside the
  `schemaTemplates` map they resemble.
- Whether a theme applies in live mode as well as read mode, or only once you stop editing.
- Export. Resolving a theme and inlining it produces a self-contained HTML file — the artifact
  case that started this discussion — but the resolved CSS and the vault fonts both have to be
  embedded for it to survive leaving the vault.
