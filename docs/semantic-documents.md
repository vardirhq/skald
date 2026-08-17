# Semantic documents

Skald keeps Markdown as the canonical file format, but it no longer has to pretend that every useful document is only a flat sequence of headings, paragraphs, lists, quotes and code fences.

The semantic document model adds a deliberately small layer on top:

> **Markdown is the source. The document tree is the model. CSS is the presentation. HTML is the renderer.**

The important distinction is that semantic containers describe **what a group of blocks means**, not how it must be laid out.

A note can therefore stay readable as plain Markdown while Skald understands richer relationships between its blocks and a note theme decides how those relationships should look.

## Why this exists

Skald's notes are plain local files. Replacing Markdown with stored HTML would make rich presentation easy, but it would also make the files noisier, harder to edit outside Skald and more dependent on Skald's current renderer.

Semantic containers are the compromise:

- the actual prose, headings, lists, tasks, links and images remain normal Markdown;
- Skald adds a small vocabulary for grouping those normal blocks;
- the runtime parses the note into a tree instead of treating it as only a list of lines;
- CSS themes style the semantic relationships;
- the underlying `.md` file remains understandable without Skald.

A viewer that does not support Skald containers may show the `:::` fences as text, but the content between them is still ordinary Markdown and remains recoverable.

## The v1 container vocabulary

The initial vocabulary is intentionally small: `aside`, `gallery` and `group`.

This is not an attempt to define every kind of document up front. New semantic types should only become permanent file-format vocabulary after real use shows that the distinction matters.

### Aside

Use an `aside` for supporting context that belongs with the document but is not part of its main narrative flow.

```md
:::aside

## Historical context

This decision was originally made because the first version only ran locally.

- The server did not exist yet
- Sync was added later
- The original constraint is no longer necessarily valid

:::
```

Good uses include:

- historical context;
- caveats;
- definitions;
- background information;
- a note to the reader;
- supporting evidence that should not interrupt the main argument.

Do not use `aside` merely because you want a box on the right. A theme may render an aside as a bordered inset, a margin note, a subdued paragraph or something else entirely.

### Gallery

Use a `gallery` when a collection of images or media should be understood as one visual group.

```md
:::gallery

![Harbour at dusk](bergen.jpg)

![Snow above the road](tromso.jpg)

![Street after rain](oslo.jpg)

:::
```

The built-in presentation uses a responsive grid, but that is only Skald's default CSS. A theme can render the same gallery as a horizontal strip, a large lead image with thumbnails, a contact sheet or a single-column photographic essay.

A gallery is semantic because the images belong together. It is not called `grid-3`, `columns` or `masonry` because those are presentation decisions.

### Group

`group` is deliberately generic. Use it when several blocks belong together but neither `aside` nor `gallery` describes why.

```md
:::group

## Release criteria

- [ ] Migration tested on an existing vault
- [ ] Mobile can still read the note
- [ ] Theme contract documented

**Owner:** [[Chris]]

:::
```

`group` is useful while the semantic vocabulary is young. Repeated real-world uses of `group` can later reveal whether a more specific type deserves to exist.

Do not immediately turn every recurring visual pattern into a new container type. A semantic type should communicate meaning even when all styling is removed.

## Using containers from the editor

The normal workflow is the Insert menu rather than typing fences manually.

Open the Insert menu with **Cmd/Ctrl+I** and search for:

- **Aside**
- **Gallery**
- **Group**

They appear under the **Containers** category.

With no selection, Skald inserts a container template and selects its placeholder content so you can immediately type into it.

For example, inserting an Aside produces:

```md
:::aside

Content

:::
```

If Markdown is selected first, the selected Markdown replaces the placeholder. Skald therefore wraps the original source rather than converting it.

Selecting:

```md
## Context

- First point
- Second point
```

and inserting **Aside** produces:

```md
:::aside

## Context

- First point
- Second point

:::
```

The heading and list are still ordinary Markdown blocks. The container only adds their relationship.

## Editing inside containers

Containers are not giant special editor blocks.

At runtime Skald represents the example above approximately as:

```text
Document
├── Container: aside
│   ├── Heading
│   ├── Blank
│   └── List
└── ...
```

The live editor consumes a flattened editable projection of that tree. Each child retains its real source line range and its semantic parent.

That means a heading inside an aside is still edited as a heading, a task is still a task and a list is still a list. Existing source-oriented behavior such as task line identity does not need a separate container implementation.

Source mode continues to expose the actual Markdown file exactly as expected.

## Nesting

Semantic containers **cannot contain other semantic containers in v1**.

This is deliberate.

Allowed:

```md
:::aside

## Context

Paragraph.

- Item one
- Item two

:::
```

Not supported in v1:

```md
:::aside

Outer content.

:::group
Nested content.
:::

:::
```

The parser reports nested containers as a document diagnostic. The restriction keeps editing, source mapping, moving blocks and future wrap/unwrap operations understandable while the model proves itself.

Nested containers can be added later if actual documents demonstrate a strong need for them.

## Source syntax

A semantic container starts with a fenced directive containing the semantic type and ends with a bare `:::` fence.

```text
:::TYPE

MARKDOWN BLOCKS

:::
```

The v1 types are lowercase:

```text
aside
gallery
group
```

Keeping blank lines around the contents is recommended. It makes the source easier to read in ordinary editors and avoids ambiguous-looking Markdown.

### Code fences

`:::` text inside a fenced code block is code, not a semantic container.

For example:

````md
```text
:::aside
This is an example, not a real aside.
:::
```
````

The document parser recognizes the code fence as one ordinary block before looking for semantic containers inside it.

### Broken fences

An opening semantic fence without a closing `:::` is not silently swallowed as a valid container. The parser records an `unclosed-container` diagnostic and leaves the content recoverable as ordinary source.

This is important because malformed presentation syntax should not make the rest of a note disappear.

## Themes and semantic containers

Semantic containers become substantially more useful when combined with note themes.

The public theme contract adds these selectors:

```css
.sk-container {}
.sk-container__content {}
.sk-container--aside {}
.sk-container--gallery {}
.sk-container--group {}
```

The renderer also exposes:

```css
[data-skald-container="1"] {}
[data-container="aside"] {}
[data-container="gallery"] {}
[data-container="group"] {}
```

The classes express stable semantics. Themes should prefer the `.sk-*` contract rather than depending on Skald's private editor classes.

### Example: restrained technical aside

```css
.sk-container--aside {
  padding: 1rem 1.2rem;
  border-left: 2px solid var(--note-accent);
  background: color-mix(in srgb, var(--note-accent) 5%, transparent);
}
```

### Example: literary margin treatment

A wide-screen theme can move supporting material into the margin without changing the Markdown:

```css
@media (min-width: 1100px) {
  .sk-container--aside {
    width: 18rem;
    margin-left: calc(100% + 2rem);
    margin-top: -2rem;
    font-size: 0.9em;
  }
}
```

That theme choice does not make the file itself a "right sidebar" document. Another theme can render the same aside inline.

### Example: photographic gallery

```css
.sk-container--gallery > .sk-container__content {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 0.75rem;
}

.sk-container--gallery .sk-figure:first-child {
  grid-row: span 2;
}
```

Again, the file only says "these images form a gallery". The CSS decides how a gallery looks.

### Example: group as a project panel

```css
.sk-container--group {
  border: 1px solid var(--note-rule);
  border-radius: var(--note-radius);
  padding: 1.25rem;
}

.sk-container--group .sk-h2:first-child {
  margin-top: 0;
}
```

## Combining containers with existing Skald features

Container children use the normal Markdown renderer, so existing features continue to work inside them.

### Tasks

```md
:::group

## Before release

- [ ] Run migration test
- [ ] Check generated installers
- [ ] Update changelog

:::
```

The task lines remain ordinary task lines with their real source coordinates.

### Wikilinks

```md
:::aside

See [[Sync design]] for why this constraint exists.

:::
```

Wikilinks resolve normally because the child paragraph uses the normal inline renderer.

### Attachments

```md
:::gallery

![Before](attachments/before.png)

![After](attachments/after.png)

:::
```

Attachment resolution is unchanged. The gallery only changes the relationship and presentation of the image blocks.

### Extension-backed blocks

Code-fence and Markdown-component extensions remain ordinary child blocks. Semantic containers do not replace the extension system.

The distinction is useful:

- extensions introduce specialized content/rendering behavior;
- containers group ordinary or specialized blocks by meaning.

## Portability

Skald's portability promise is intentionally stronger than "works only in Skald" and intentionally weaker than "every Markdown viewer renders every Skald feature perfectly."

The rule is:

> **A Skald note should remain understandable and recoverable outside Skald, even when richer presentation is lost.**

A generic editor can still read the headings, prose, images, tasks and links between the fences. A processor that understands Pandoc-style fenced-div families may be able to transform the structure further. A basic Markdown viewer may simply show the directive markers.

Skald does not persist a hidden JSON document tree beside the note and does not replace the note with generated HTML.

## Runtime architecture

The canonical implementation lives in `src-shared/documentTree.ts`.

The parser produces:

```ts
interface MarkdownDocument {
  type: 'document';
  source: string;
  children: DocumentNode[];
  diagnostics: DocumentDiagnostic[];
}

type DocumentNode = MarkdownBlockNode | SemanticContainerNode;
```

A container owns ordinary block children:

```ts
interface SemanticContainerNode {
  type: 'container';
  kind: 'aside' | 'gallery' | 'group';
  children: MarkdownBlockNode[];
  startLine: number;
  endLine: number;
  raw: string;
}
```

Every child retains its source line range. This is intentionally different from storing a browser DOM or an opaque rich-text model.

The rendering path is:

```text
Markdown source
    ↓
parseDocumentTree
    ↓
MarkdownDocument
    ↓
React renderer
    ↓
HTML / DOM
    ↓
Skald surface CSS + optional note theme
```

The live-editing path is currently:

```text
Markdown source
    ↓
parseDocumentTree
    ↓
flattenEditableBlocks
    ↓
existing source-aware live block editor
```

That compatibility projection is deliberate. It lets the runtime become tree-shaped without rewriting every caret and source-mapping behavior at once.

## Design rules for future semantic types

Before adding another permanent container type, ask these questions:

1. Does the name describe meaning rather than layout?
2. Would the distinction still make sense with all CSS removed?
3. Is it meaningfully different from `group`?
4. Has a real use case appeared repeatedly enough to justify permanent syntax?
5. Can the contents remain ordinary Markdown blocks?

Good candidates may eventually include concepts such as `comparison`, `sources` or `timeline` if repeated use demonstrates that Skald benefits from understanding those meanings.

Bad candidates include `two-column`, `grid-3`, `left-sidebar`, `wide-card` and similar names that freeze one visual fashion into the file format.

## What v1 intentionally does not do

The first version does not try to solve every rich-document problem.

It does not provide:

- nested semantic containers;
- arbitrary HTML storage;
- arbitrary layout directives in Markdown;
- persisted DOM or editor-state JSON;
- automatic semantic inference from CSS;
- AI-generated free-form HTML;
- a large permanent container vocabulary.

Those omissions protect the central model rather than limiting it accidentally.

## Where this leads

Once the document tree and semantic vocabulary are established, richer features become safer to build.

A future command can transform selected blocks into an Aside by manipulating source ranges rather than scraping rendered HTML. A container toolbar can offer **Change type**, **Move**, **Unwrap** and **Delete**. Themes can radically change composition while preserving the document's meaning.

AI can eventually operate on the same controlled vocabulary:

- turn research notes into a comparison;
- group supporting context into asides;
- collect related images into galleries;
- choose or generate a restrained note theme;
- restructure a project note without generating arbitrary HTML.

The important constraint remains the same: AI would manipulate Skald's document semantics and Markdown source, not invent a second uncontrolled document format.

That is the reason the tree exists. It gives Skald richer documents without giving up the boring, durable thing underneath them: a text file you still own.
