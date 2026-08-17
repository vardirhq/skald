# Note themes

A design proposal, not yet implemented.

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

Every theme declares the contract version it was written against, as the first line of the file:

```css
/* skald-theme: 1 */
```

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

| Token | Default | Controls |
| --- | --- | --- |
| `--note-font-body` | `var(--font-ui)` | Body and list text |
| `--note-font-heading` | `var(--font-ui)` | Headings |
| `--note-font-mono` | `var(--font-mono)` | Code, inline and block |
| `--note-size-body` | inherited | Base body size |
| `--note-line-height` | inherited | Body leading |
| `--note-scale` | `1.25` | Heading size ratio |
| `--note-measure` | current column | Content column width |
| `--note-space-block` | current gap | Space between blocks |
| `--note-space-section` | current gap | Space above headings |
| `--note-bg` | `var(--bg-2)` | Surface behind the note |
| `--note-tx` | `var(--tx-1)` | Body text |
| `--note-tx-muted` | `var(--tx-2)` | Captions, meta, labels |
| `--note-tx-heading` | `var(--tx-0)` | Heading text |
| `--note-accent` | `var(--ac)` | Links, markers, emphasis |
| `--note-rule` | `var(--line-2)` | Hairlines and `<hr>` |
| `--note-radius` | `var(--r-2)` | Cards, code, callouts |
| `--note-code-bg` | `var(--bg-3)` | Code block surface |
| `--note-quote-border` | `var(--line-3)` | Blockquote edge |
| `--note-link` | `var(--ac)` | Resolved links |
| `--note-link-missing` | `var(--err)` | Unresolved wikilinks |
| `--note-task-working` | `var(--sy-blue)` | `@status(working)` marker |
| `--note-task-blocked` | `var(--err)` | `@status(blocked)` marker |
| `--note-task-overdue` | `var(--err)` | Past-due marker |

Tokens referencing app tokens is deliberate: a theme that only changes `--note-font-body` still
follows Midnight, Slate, and Daybreak correctly, and still respects the density setting.

## Tier 2 — the class contract

Version 1 promises these names. Elements marked *new* do not exist yet; see
[Renderer changes](#renderer-changes-required) below.

**Container**

| Class | Element | Notes |
| --- | --- | --- |
| `.sk-note` | wrapper | *new* — the scope root. Carries `data-schema`. |

**Blocks**

| Class | Element | Currently |
| --- | --- | --- |
| `.sk-p` | `<p>` | no class |
| `.sk-h1` | `<h1>` | `.body-h1` |
| `.sk-h2` | `<h2>` | no class; inner `.h2-text` span is private |
| `.sk-h3` | `<h3>` | no class |
| `.sk-quote` | `<blockquote>` | no class |
| `.sk-callout` | `<div>` | `.editor-callout` |
| `.sk-callout__label` | `<div>` | `.label` |
| `.sk-code` | `<pre>` | `.codeblock`, keeps `data-lang` |
| `.sk-rule` | `<hr>` | no class |
| `.sk-list` | `<ul>` | `.plain` |
| `.sk-list--ordered` | `<ol>` | `.plain` |
| `.sk-list__item` | `<li>` | no class |

**Tasks**

| Class | Element | Currently |
| --- | --- | --- |
| `.sk-tasks` | `<ul>` | `.tasks` |
| `.sk-task` | `<li>` | no class; keeps `data-done` |
| `.sk-task__box` | `<span>` | `.checkbox`; keeps `data-done` |
| `.sk-task__label` | `<span>` | `.task-label` |
| `.sk-task__meta` | `<span>` | `.task-meta` |
| `.sk-task__status` | `<span>` | *new* — carries `data-status` |
| `.sk-task__due` | `<span>` | `.due` / `.due--ok`; gains `data-overdue` |

**Inline**

| Class | Element | Currently |
| --- | --- | --- |
| `.sk-wikilink` | `<a>` | `.wikilink` |
| `.sk-wikilink--missing` | `<a>` | `.wikilink--missing` |
| `.sk-link` | `<a>` | *new* — external links, today indistinguishable |
| `.sk-code-inline` | `<code>` | no class |
| `.sk-figure` | `<span>` | `.attachment-image` |
| `.sk-figure__caption` | `<span>` | `.attachment-image__caption` |
| `.sk-figure--missing` | `<span>` | `.attachment--missing` |
| `.sk-file` | `<span>` | `.attachment-card` |
| `.sk-file__icon` | `<span>` | `.attachment-card__icon` |
| `.sk-file__text` | `<span>` | `.attachment-card__text` |

`<strong>`, `<em>`, `<del>`, `<br>`, and `<img>` carry no class and are targeted by tag. The
`data-done`, `data-lang`, `data-status`, `data-overdue`, and `data-schema` attributes are part
of the contract and can be selected on.

## Renderer changes required

`src/markdown.tsx` cannot back this contract as written. Five things need fixing first, and all
of them are cheaper to fix now than after themes exist in the wild.

**No wrapper element.** `renderMarkdown` returns a bare array of nodes, dropped into
`.editor-body` (`Editor.tsx:584`, `Editor.tsx:1206`) alongside editor furniture like
`.live-block` and its textareas. There is no element that means "the note and only the note", so
there is nothing to scope a theme to. `.sk-note` has to be introduced.

**`h2` wraps its text in a presentational span.** `markdown.tsx:114` renders
`<h2><span className="h2-text">`. That span is an implementation detail of the current heading
treatment. The public class goes on the `<h2>`; the span stays private and removable.

**`h4`–`h6` silently become `<h3>`.** The `else` branch at `markdown.tsx:117` catches every
level above 2. The contract therefore cannot offer `.sk-h4` and beyond. Either the renderer
learns the remaining levels, or the collapse is documented as intended — but it should be a
decision, not an accident inherited by every future theme.

**External links are indistinguishable from wikilinks.** `markdown.tsx:382` gives an external
`[text](url)` the same `wikilink` class as an internal `[[Note]]`. No theme can style them
differently. `.sk-link` has to be a real, separate class before the contract is published.

**Task status colours are inline styles.** `markdown.tsx:196-197` writes
`style={{ color: 'var(--sy-blue)' }}` for working and `var(--err)` for blocked. Inline styles
beat any stylesheet rule that is not `!important`, so a theme literally cannot restyle them.
These become `.sk-task__status[data-status]` reading the tokens above.

Note also that several current names are generic enough to be hazardous as public API — `.label`
inside a callout, `.plain` on lists, `.checkbox`, and `.editor-callout`, which reads as chrome
because it is adjacent to chrome. Emitting the `sk-` names alongside them, rather than renaming,
keeps the app's own stylesheet free to change.

## Scoping and safety

No scripts are involved: a theme is CSS, loaded from the user's own vault, and cannot execute.
That is the whole reason this is a smaller feature than embedding HTML in notes.

It still needs boundaries, because CSS can reach further than the note:

- User CSS is injected into a `<style>` scoped to the reading surface with
  `@scope (.sk-note)`, native in the Chromium version Electron ships. Where `@scope` is not
  available, selectors are parsed and prefixed instead.
- Rejected at load: `@import`, `url()` pointing at a remote host, and selectors targeting
  `:root`, `html`, or `body`. Remote URLs are a tracking beacon that fires when a note opens —
  the same rule the rest of Skald follows.
- `position: fixed` is neutralized so a theme cannot float content over the chrome.
- A **Reset this note's theme** command is always available and cannot be overridden by a
  theme. MySpace was fun because expression was unbounded and painful because pages became
  unreadable; one guaranteed escape is enough insurance.

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

## Open questions

- Where the version marker lives. A leading CSS comment is readable and survives hand-editing,
  but it is fragile to reformatting; a custom property on `.sk-note` is more robust and uglier.
- Whether schema defaults are stored in Skald settings or as a file in the vault. Settings are
  simpler; a file is consistent with themes surviving the app.
- Whether `h4`–`h6` justify the renderer change, or the collapse to `h3` is the intended reading
  experience.
- Export. Resolving a theme and inlining it produces a self-contained HTML file — the artifact
  case that started this discussion — but the resolved CSS and the vault fonts both have to be
  embedded for it to survive leaving the vault.
