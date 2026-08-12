import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AttachmentImportResult,
  AttachmentRef,
  NoteHistoryEntry,
  NoteHistoryVersion,
  NotePayload,
  VaultSnapshot,
} from '../../src-shared/types';
import { renderMarkdown, type MdContext } from '../markdown';
import { Rune, schemaTone } from '../ui/runes';
import { DialogScrim, TextDialog } from '../ui/dialogs';
import { api } from '../api';
import { useStore, todayISO, relTime } from '../store';
import { taskId } from '../../src-shared/tasks';
import { countWords } from '../../src-shared/notes';
import { parseFrontmatter, serializeFrontmatter } from '../../src-shared/frontmatter';
import { extensionRegistry } from '../extensions/registry';
import type { EditorInsertContribution, NotePropertyContribution } from '../extensions/types';
import {
  enterInBlock,
  offsetAt,
  positionAt,
  replaceMarkdownBody,
  replaceMarkdownBlock,
  softBreakInBlock,
  sourceOffsetFromRendered,
  splitMarkdownBlocks,
  type MarkdownBlock,
} from '../../src-shared/liveMarkdown';
import { buildLinkIndex, resolveLinkTarget } from '../../src-shared/wikilinks';
import { completeTag, matchingTags, tagCompletionAt, type TagCompletionRange } from '../../src-shared/tags';
import {
  applyInsertion,
  coreInsertions,
  extensionInsertions,
  type InsertMenuItem,
  type TextSelection,
} from '../editor/insertions';
import { InsertMenu } from './InsertMenu';
import { OPEN_INSERT_MENU_EVENT } from '../editor/events';

type EditorMode = 'live' | 'preview' | 'source';

const extensionPropertyKeys = new Set(extensionRegistry.noteProperties.map((item) => item.key));

export function EditorView({
  snapshot,
  path,
}: {
  snapshot: VaultSnapshot;
  path: string;
}) {
  const openNote = useStore((s) => s.openNote);
  const setDirtyStore = useStore((s) => s.setDirty);
  const setDocStatus = useStore((s) => s.setDocStatus);
  const notePathRenamed = useStore((s) => s.notePathRenamed);
  const showToast = useStore((s) => s.showToast);
  const setSwitcherOpen = useStore((s) => s.setSwitcherOpen);
  const editorLocation = useStore((s) => s.editorLocation);
  const clearEditorLocation = useStore((s) => s.clearEditorLocation);
  const marginOn = snapshot.settings.marginOn;

  const [payload, setPayload] = useState<NotePayload | null>(null);
  const [mode, setMode] = useState<EditorMode>('live');
  const [draft, setDraft] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingExtensionProperty, setEditingExtensionProperty] = useState<string | null>(null);
  const [pendingExtensionInsertion, setPendingExtensionInsertion] = useState<string | null>(null);
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [liveRequestedSelection, setLiveRequestedSelection] = useState<(TextSelection & { revision: number }) | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [lncol, setLncol] = useState<[number, number] | null>(null);
  const [sourceTagRange, setSourceTagRange] = useState<TagCompletionRange | null>(null);
  const [sourceTagSelected, setSourceTagSelected] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSelectionRef = useRef<TextSelection | null>(null);
  const pendingBodySelectionRef = useRef<TextSelection | null>(null);
  const insertionRevision = useRef(0);

  const meta = useMemo(
    () => snapshot.notes.find((n) => n.path === path) ?? null,
    [snapshot.notes, path]
  );
  const linkIndex = useMemo(() => buildLinkIndex(snapshot.notes), [snapshot.notes]);
  const dirty = draft !== null && draft !== payload?.content;
  const knownTags = useMemo(
    () => [...new Set([...snapshot.notes.flatMap((note) => note.tags), ...snapshot.tasks.flatMap((task) => task.tags)])],
    [snapshot.notes, snapshot.tasks]
  );
  const sourceTagMatches = sourceTagRange ? matchingTags(knownTags, sourceTagRange.query) : [];

  const load = useCallback(async () => {
    try {
      const p = await api.readNote(path);
      setPayload(p);
      setDraft(null);
      setDirtyStore(path, false);
    } catch {
      setPayload(null);
    }
  }, [path, setDirtyStore]);

  // load on note switch
  useEffect(() => {
    setMode('live');
    setDraft(null);
    setLncol(null);
    setInsertMenuOpen(false);
    liveSelectionRef.current = null;
    pendingBodySelectionRef.current = null;
    void load();
  }, [path]);

  // Full-text search opens the source at the exact file coordinate. Source
  // mode is deliberate here: every body match has a stable caret position,
  // while rendered Markdown may not contain the source characters verbatim.
  useEffect(() => {
    if (!payload || editorLocation?.path !== path) return;
    if (mode !== 'source') {
      setMode('source');
      return;
    }
    const lines = payload.content.split('\n');
    const line = Math.max(1, Math.min(editorLocation.line, lines.length));
    let offset = 0;
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
    offset += Math.max(0, Math.min(editorLocation.column - 1, lines[line - 1].length));
    const end = Math.min(payload.content.length, offset + editorLocation.length);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(offset, end);
      taRef.current?.scrollTo({ top: Math.max(0, (line - 5) * 20), behavior: 'smooth' });
      clearEditorLocation();
    });
  }, [payload, editorLocation, mode, path, clearEditorLocation]);

  // refresh from disk when the vault changes under us (unless mid-edit)
  useEffect(() => {
    if (!dirty && meta && payload && meta.updated > 0) void load();
  }, [meta?.updated]);

  // report status bar info
  useEffect(() => {
    const words =
      draft !== null ? countWords(draft) : payload ? payload.meta.wordCount : meta?.wordCount;
    setDocStatus({
      schema: meta?.schema,
      words,
      lncol: mode === 'source' || mode === 'live' ? lncol : null,
    });
    return () => setDocStatus({});
  }, [meta?.schema, payload, draft, mode, lncol]);

  const scheduleSave = useCallback(
    (content: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void api.writeNote(path, content).then(() => {
          setPayload((p) => (p ? { ...p, content } : p));
          setDirtyStore(path, false);
        });
      }, snapshot.settings.autosaveMs);
    },
    [path, snapshot.settings.autosaveMs, setDirtyStore]
  );

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draft !== null && dirty) {
      void api.writeNote(path, draft).then(() => {
        setPayload((p) => (p ? { ...p, content: draft } : p));
        setDirtyStore(path, false);
        showToast('Saved');
      });
    }
  }, [draft, dirty, path]);

  // ⌘S / ⌘E / ⌘I
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's') {
        e.preventDefault();
        saveNow();
      }
      if (mod && e.key === 'e') {
        e.preventDefault();
        setMode((m) => (m === 'source' ? 'live' : 'source'));
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setSwitcherOpen(false);
        setInsertMenuOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveNow, setSwitcherOpen]);

  useEffect(() => {
    const open = () => {
      setSwitcherOpen(false);
      setInsertMenuOpen(true);
    };
    window.addEventListener(OPEN_INSERT_MENU_EVENT, open);
    return () => window.removeEventListener(OPEN_INSERT_MENU_EVENT, open);
  }, [setSwitcherOpen]);

  // flush pending save when leaving the note
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [path]);

  const insertAttachments = useCallback(
    async (items: AttachmentImportResult[]) => {
      if (items.length === 0) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);

      const current = draft ?? payload?.content ?? '';
      const block = items.map((item) => item.markdown).join('\n');
      const textarea = mode === 'source' ? taRef.current : null;
      const start = textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? current.length;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const prefix = before.length === 0 || before.endsWith('\n') ? '' : '\n\n';
      const suffix = after.length === 0 ? '\n' : after.startsWith('\n') ? '' : '\n\n';
      const next = before + prefix + block + suffix + after;

      try {
        await api.writeNote(path, next);
        const fresh = await api.readNote(path);
        setPayload(fresh);
        setDraft(null);
        setDirtyStore(path, false);
        showToast(items.length === 1 ? `Attached ${items[0].name}` : `Attached ${items.length} files`);

        if (textarea) {
          const cursor = (before + prefix + block + suffix).length;
          requestAnimationFrame(() => {
            taRef.current?.focus();
            taRef.current?.setSelectionRange(cursor, cursor);
          });
        }
      } catch (err) {
        showToast(`Could not attach file: ${String((err as Error).message ?? err)}`);
      }
    },
    [draft, mode, path, payload?.content, setDirtyStore, showToast]
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      const withPaths = files.map((file) => ({ file, path: api.pathForFile(file) }));
      const pathFiles = withPaths.filter((item) => item.path);
      const memoryFiles = withPaths.filter((item) => !item.path).map((item) => item.file);
      const imported: AttachmentImportResult[] = [];

      try {
        if (pathFiles.length > 0) {
          imported.push(...(await api.importAttachmentPaths(path, pathFiles.map((item) => item.path))));
        }
        for (const file of memoryFiles) {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          imported.push(
            await api.importAttachmentData(path, file.name || 'attachment', file.type, bytes)
          );
        }
        await insertAttachments(imported);
      } catch (err) {
        showToast(`Could not import file: ${String((err as Error).message ?? err)}`);
      }
    },
    [insertAttachments, path, showToast]
  );

  const attachmentFor = useCallback(
    (target: string): AttachmentRef | null =>
      payload?.attachments.find((item) => item.target === target) ?? null,
    [payload?.attachments]
  );

  if (!meta) {
    return <div className="empty-note">This note is gone — it may have been deleted on disk.</div>;
  }

  const content = draft ?? payload?.content ?? '';
  const parsedContent = useMemo(() => parseFrontmatter(content), [content]);
  const body = parsedContent.body;
  const bodyStartLine = parsedContent.bodyStartLine;

  const mdCtx: MdContext = {
    resolve: (target) => resolveLinkTarget(linkIndex, target),
    openNote,
    openExternal: (url) => window.open(url),
    resolveAttachment: attachmentFor,
    openAttachment: (attachmentPath) => void api.openAttachment(attachmentPath),
    attachmentUrl: api.attachmentUrl,
    toggleTask: (line, done) => {
      void api.updateTask(taskId(path, line), { status: done ? 'done' : 'open' });
    },
    todayISO: todayISO(),
    lineOffset: bodyStartLine,
    frontmatter: parsedContent.frontmatter,
  };

  const noteTasks = snapshot.tasks.filter((t) => t.notePath === path);
  const fmEntries = Object.entries(parsedContent.frontmatter).filter(
    ([k]) => k !== 'schema' && !extensionPropertyKeys.has(k)
  );

  const onSourceChange = (v: string) => {
    setDraft(v);
    setDirtyStore(path, true);
    scheduleSave(v);
  };

  const updateSourceTagCompletion = (value: string, cursor: number) => {
    setSourceTagRange(tagCompletionAt(value, cursor));
    setSourceTagSelected(0);
  };

  const chooseSourceTag = (tag: string) => {
    if (!sourceTagRange) return;
    const result = completeTag(content, sourceTagRange, tag);
    onSourceChange(result.text);
    setSourceTagRange(null);
    requestAnimationFrame(() => taRef.current?.setSelectionRange(result.caret, result.caret));
  };

  const onBodyChange = (nextBody: string) => {
    const next = replaceMarkdownBody(content, bodyStartLine, nextBody);
    setDraft(next);
    setDirtyStore(path, true);
    scheduleSave(next);
  };

  const setExtensionProperty = (
    property: NotePropertyContribution,
    value: string | null,
    insertion?: EditorInsertContribution
  ) => {
    const frontmatter = { ...parsedContent.frontmatter };
    if (value) frontmatter[property.key] = value;
    else delete frontmatter[property.key];
    const nextBody = insertion
      ? applyInsertion(
          body,
          pendingBodySelectionRef.current ?? { start: body.length, end: body.length },
          { markdown: insertion.markdown, placeholder: insertion.placeholder, block: true }
        ).text
      : body;
    pendingBodySelectionRef.current = null;
    onSourceChange(serializeFrontmatter(frontmatter, nextBody));
  };

  const insertItem = (item: InsertMenuItem) => {
    const insertion = item.extension;
    if (insertion?.propertyKey) {
      const property = extensionRegistry.noteProperty(insertion.propertyKey);
      if (!property) throw new Error(`Missing extension property ${insertion.propertyKey}`);
      if (!property.normalize(parsedContent.frontmatter[property.key])) {
        pendingBodySelectionRef.current = bodySelection(
          mode,
          content,
          body,
          bodyStartLine,
          taRef.current,
          liveSelectionRef.current
        );
        setPendingExtensionInsertion(insertion.id);
        setEditingExtensionProperty(property.key);
        return;
      }
    }
    if (mode === 'source' && taRef.current) {
      const ta = taRef.current;
      const result = applyInsertion(content, { start: ta.selectionStart, end: ta.selectionEnd }, item);
      onSourceChange(result.text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result.start, result.end);
      });
      return;
    }
    const selection = mode === 'live' && liveSelectionRef.current
      ? liveSelectionRef.current
      : { start: body.length, end: body.length };
    const result = applyInsertion(body, selection, item);
    onBodyChange(result.text);
    setMode('live');
    insertionRevision.current += 1;
    setLiveRequestedSelection({
      start: result.start,
      end: result.end,
      revision: insertionRevision.current,
    });
  };

  const insertItems = useMemo(
    () => [...coreInsertions, ...extensionInsertions(extensionRegistry.editorInsertions)],
    []
  );

  const activeExtensionProperty = editingExtensionProperty
    ? extensionRegistry.noteProperty(editingExtensionProperty)
    : undefined;
  const activeExtensionInsertion = pendingExtensionInsertion
    ? extensionRegistry.editorInsertion(pendingExtensionInsertion)
    : undefined;

  const updateLnCol = () => {
    const ta = taRef.current;
    if (!ta) return;
    const upto = ta.value.slice(0, ta.selectionStart);
    const lines = upto.split('\n');
    setLncol([lines.length, lines[lines.length - 1].length + 1]);
  };

  const scrollToHeading = (line: number) => {
    setMode((m) => (m === 'source' ? 'live' : m));
    requestAnimationFrame(() => {
      const el = previewRef.current?.querySelector(`#h-${line}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className={'editor-shell' + (marginOn ? '' : ' editor-shell--no-margin')}>
      <div
        className={'editor-pane' + (draggingFiles ? ' editor-pane--dragging' : '')}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDraggingFiles(true);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingFiles(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingFiles(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          const images = Array.from(e.clipboardData.files).filter((file) =>
            file.type.startsWith('image/')
          );
          if (images.length === 0) return;
          e.preventDefault();
          void importFiles(images);
        }}
      >
        {draggingFiles && <div className="editor-drop-overlay">Drop files to attach</div>}
        <div className="editor-page" ref={previewRef}>
          <div className="editor-eyebrow">
            <span className="dot" />
            <span className="path">{path}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--tx-3)' }}>
              {dirty ? 'editing…' : `edited ${relTime(meta.updated)} ago`}
            </span>
            <button
              className="editor-attach-button"
              title="Attach files"
              onClick={() => void api.selectAttachments(path).then(insertAttachments)}
            >
              + attach
            </button>
            <button
              className="editor-attach-button editor-insert-button"
              title="Insert Markdown or an extension component — ⌘I"
              onClick={() => setInsertMenuOpen(true)}
            >
              + insert <span className="kbd">⌘I</span>
            </button>
            <span className="editor-mode-toggle">
              <button aria-selected={mode === 'live'} onClick={() => setMode('live')} title="Live editor — ⌘E">
                live
              </button>
              <button aria-selected={mode === 'preview'} onClick={() => setMode('preview')} title="Reading view">
                read
              </button>
              <button aria-selected={mode === 'source'} onClick={() => setMode('source')} title="Source view — ⌘E">
                src
              </button>
            </span>
          </div>

          <h1
            className="editor-title"
            title="Double-click to rename"
            onDoubleClick={() => setRenaming(true)}
          >
            {meta.title}
          </h1>

          {mode !== 'source' ? (
            <>
              <div className="editor-frontmatter" data-schema={meta.schema}>
                <div className="k">title</div>
                <div className="v">{meta.title}</div>
                <div className="k">schema</div>
                <div className="v">
                  <span className="pill">{meta.schema}</span>
                </div>
                {extensionRegistry.noteProperties.map((property) => {
                  const value = property.normalize(parsedContent.frontmatter[property.key]);
                  return (
                    <Fragment key={property.key}>
                      <div className="k">{property.label}</div>
                      <div className="v extension-property">
                        {value ? (
                          <>
                            {property.externalUrl ? (
                              <button onClick={() => window.open(property.externalUrl!(value))}>{value}</button>
                            ) : (
                              <span>{value}</span>
                            )}
                            <span className="muted">·</span>
                            <button onClick={() => setEditingExtensionProperty(property.key)}>edit</button>
                            <span className="muted">·</span>
                            <button onClick={() => setExtensionProperty(property, null)}>remove</button>
                          </>
                        ) : (
                          <button onClick={() => setEditingExtensionProperty(property.key)}>{property.emptyLabel}</button>
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                {fmEntries.map(([k, v]) => (
                  <FmRow key={k} k={k} v={v} ctx={mdCtx} />
                ))}
                {meta.links.length > 0 && (
                  <>
                    <div className="k">links</div>
                    <div className="v">
                      {meta.links.map((l, i) => {
                        const target = snapshot.notes.find((n) => n.path === l);
                        return (
                          <span key={l}>
                            {i > 0 && ' · '}
                            <a
                              className="wikilink"
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                openNote(l);
                              }}
                            >
                              [[{target?.title ?? l}]]
                            </a>
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {mode === 'live' ? (
                <LiveMarkdownEditor
                  body={body}
                  ctx={mdCtx}
                  fontSize={snapshot.settings.editorFontSize}
                  onChange={onBodyChange}
                  onBlur={saveNow}
                  onLnCol={setLncol}
                  tags={knownTags}
                  requestedSelection={liveRequestedSelection}
                  onSelectionChange={(selection) => { liveSelectionRef.current = selection; }}
                />
              ) : (
                <div className="editor-body">
                  {body.trim() ? (
                    renderMarkdown(body, mdCtx)
                  ) : (
                    <p className="editor-empty-hint">
                      An empty page. Switch to <code>live</code> (⌘E) and start writing.
                    </p>
                  )}
                </div>
              )}

              <AddThread path={path} />

              {payload && payload.backlinks.length > 0 && (
                <div className="editor-foot">
                  <div className="editor-foot__label">
                    Linked from · {payload.backlinks.length}{' '}
                    {payload.backlinks.length === 1 ? 'note' : 'notes'}
                  </div>
                  <div className="editor-foot__chips">
                    {payload.backlinks.map((b) => (
                      <span
                        key={b.path}
                        className="chip"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openNote(b.path)}
                      >
                        <span className="chip__rune" style={{ color: schemaTone(b.schema) }}>
                          <Rune schema={b.schema} size={13} />
                        </span>
                        {b.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="editor-source-wrap">
              <textarea
                ref={taRef}
                className="editor-source"
                value={content}
                spellCheck={false}
                onChange={(e) => {
                  onSourceChange(e.target.value);
                  updateSourceTagCompletion(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={(e) => {
                  if (!sourceTagMatches.length) return;
                  if (e.key === 'ArrowDown') {
                    setSourceTagSelected((index) => Math.min(sourceTagMatches.length - 1, index + 1));
                    e.preventDefault();
                  } else if (e.key === 'ArrowUp') {
                    setSourceTagSelected((index) => Math.max(0, index - 1));
                    e.preventDefault();
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    chooseSourceTag(sourceTagMatches[sourceTagSelected]);
                    e.preventDefault();
                  } else if (e.key === 'Escape') {
                    setSourceTagRange(null);
                    e.preventDefault();
                  }
                }}
                onKeyUp={(e) => {
                  updateLnCol();
                  if (CARET_KEYS.has(e.key)) updateSourceTagCompletion(e.currentTarget.value, e.currentTarget.selectionStart);
                }}
                onClick={(e) => {
                  updateLnCol();
                  updateSourceTagCompletion(e.currentTarget.value, e.currentTarget.selectionStart);
                }}
                onBlur={() => {
                  setTimeout(() => setSourceTagRange(null), 120);
                  saveNow();
                }}
                style={{ fontSize: snapshot.settings.editorFontSize - 1.5 }}
              />
              {sourceTagMatches.length > 0 && (
                <TagSuggestions tags={sourceTagMatches} selected={sourceTagSelected} onChoose={chooseSourceTag} />
              )}
            </div>
          )}
        </div>
      </div>

      {marginOn && (
        <aside className="margin">
          <div className="margin__group">
            <div className="margin__heading">
              Backlinks <span className="count">{payload?.backlinks.length ?? 0}</span>
            </div>
            {(payload?.backlinks ?? []).map((b) => (
              <div key={b.path} className="margin__item" onClick={() => openNote(b.path)}>
                <div className="margin__item__title">{b.title}</div>
                <div className="margin__item__snippet">{b.snippet}</div>
                <div className="margin__item__meta">
                  <span>{relTime(b.updated)} ago</span>
                  <span>·</span>
                  <span>{b.folder}</span>
                </div>
              </div>
            ))}
            {(payload?.backlinks.length ?? 0) === 0 && (
              <div className="margin__gloss">Nothing links here yet. Mention this note as [[{meta.title}]] elsewhere.</div>
            )}
          </div>

          {noteTasks.length > 0 && (
            <div className="margin__group">
              <div className="margin__heading">
                Threads <span className="count">{noteTasks.filter((t) => t.status !== 'done').length}</span>
              </div>
              {noteTasks.map((t) => {
                const over = !!t.due && t.due < todayISO() && t.status !== 'done';
                return (
                  <div key={t.id} className="margin__task" data-done={t.status === 'done'}>
                    <span
                      className="checkbox"
                      data-done={t.status === 'done'}
                      onClick={() =>
                        void api.updateTask(t.id, {
                          status: t.status === 'done' ? 'open' : 'done',
                        })
                      }
                    />
                    <span className="t">{t.content}</span>
                    {t.due && <span className={'due' + (over ? ' over' : '')}>{t.due.slice(5)}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {(payload?.attachments.length ?? 0) > 0 && (
            <div className="margin__group">
              <div className="margin__heading">
                Attachments <span className="count">{payload?.attachments.length}</span>
              </div>
              {payload?.attachments.map((attachment, index) => (
                <div
                  key={`${attachment.target}-${index}`}
                  className="margin__attachment"
                  data-missing={!attachment.exists}
                >
                  <button
                    className="margin__attachment-main"
                    disabled={!attachment.exists || !attachment.path}
                    onClick={() => attachment.path && void api.openAttachment(attachment.path)}
                  >
                    <span className="margin__attachment-kind">{attachment.kind}</span>
                    <span>
                      <strong>{attachment.label || attachment.target.split('/').pop()}</strong>
                      <small>
                        {attachment.exists && attachment.size !== null
                          ? formatBytes(attachment.size)
                          : 'missing'}
                      </small>
                    </span>
                  </button>
                  {attachment.exists && attachment.path && (
                    <button
                      className="margin__attachment-reveal"
                      title="Reveal in file manager"
                      onClick={() => void api.revealAttachment(attachment.path!)}
                    >
                      ↗
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="margin__group">
            <div className="margin__heading">Outline</div>
            <div className="margin__outline">
              {meta.headings.map((h) => (
                <a
                  key={h.line}
                  href="#"
                  style={{ paddingLeft: 8 + (h.level - 1) * 10 }}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToHeading(h.line);
                  }}
                >
                  {h.text}
                </a>
              ))}
              {meta.headings.length === 0 && (
                <div className="margin__gloss">No headings yet.</div>
              )}
            </div>
          </div>

          <div className="margin__group margin__history">
            <button
              className="margin__history-button"
              disabled={dirty}
              title={dirty ? 'Wait for the note to save before opening history' : 'Preview or restore an earlier version'}
              onClick={() => setHistoryOpen(true)}
            >
              <span>
                <strong>Note history</strong>
                <small>Preview and restore local snapshots</small>
              </span>
              <span aria-hidden="true">↶</span>
            </button>
          </div>
        </aside>
      )}

      {renaming && (
        <TextDialog
          title="Rename note"
          lede="Wikilinks pointing at this note are updated across the vault."
          label="New title"
          initial={meta.title}
          submitLabel="Rename"
          onSubmit={async (name) => {
            const newPath = await api.renameNote(path, name);
            notePathRenamed(path, newPath);
          }}
          onClose={() => setRenaming(false)}
        />
      )}

      {activeExtensionProperty && (
        <TextDialog
          title={activeExtensionProperty.dialogTitle(
            !!activeExtensionProperty.normalize(parsedContent.frontmatter[activeExtensionProperty.key])
          )}
          lede={activeExtensionProperty.dialogLede}
          label={activeExtensionProperty.inputLabel}
          initial={activeExtensionProperty.normalize(parsedContent.frontmatter[activeExtensionProperty.key]) ?? ''}
          submitLabel={activeExtensionInsertion
            ? `${activeExtensionProperty.submitLabel} and insert`
            : activeExtensionProperty.submitLabel}
          onSubmit={async (value) => {
            const normalized = activeExtensionProperty.normalize(value);
            if (!normalized) throw new Error(`Invalid ${activeExtensionProperty.label} value`);
            setExtensionProperty(activeExtensionProperty, normalized, activeExtensionInsertion);
            setPendingExtensionInsertion(null);
          }}
          onClose={() => {
            setEditingExtensionProperty(null);
            setPendingExtensionInsertion(null);
          }}
        />
      )}

      {insertMenuOpen && (
        <InsertMenu
          items={insertItems}
          onInsert={insertItem}
          onClose={() => setInsertMenuOpen(false)}
        />
      )}

      {historyOpen && (
        <HistoryDialog
          path={path}
          onClose={() => setHistoryOpen(false)}
          onRestored={async () => {
            setDraft(null);
            setDirtyStore(path, false);
            await load();
            showToast('Earlier version restored');
          }}
        />
      )}
    </div>
  );
}

function HistoryDialog({
  path,
  onClose,
  onRestored,
}: {
  path: string;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState<NoteHistoryVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .listNoteHistory(path)
      .then((items) => {
        if (!alive) return;
        setEntries(items);
        setSelected(items[0]?.id ?? null);
      })
      .catch((err) => alive && setError(String((err as Error).message ?? err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    if (!selected) {
      setVersion(null);
      return;
    }
    let alive = true;
    setVersion(null);
    setError(null);
    void api
      .readNoteHistoryVersion(path, selected)
      .then((item) => alive && setVersion(item))
      .catch((err) => alive && setError(String((err as Error).message ?? err)));
    return () => {
      alive = false;
    };
  }, [path, selected]);

  const restore = async () => {
    if (!selected || restoring) return;
    setRestoring(true);
    setError(null);
    try {
      await api.restoreNoteHistoryVersion(path, selected);
      await onRestored();
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setRestoring(false);
    }
  };

  return (
    <DialogScrim onClose={onClose} className="dialog--history">
      <div className="history-dialog">
        <div className="history-dialog__head">
          <div>
            <h2>Note history</h2>
            <p className="lede">Snapshots are stored locally inside this vault.</p>
          </div>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
        {loading ? (
          <div className="history-dialog__empty">Loading snapshots…</div>
        ) : entries.length === 0 ? (
          <div className="history-dialog__empty">
            No earlier versions yet. Skald creates one before the note changes.
          </div>
        ) : (
          <div className="history-dialog__body">
            <div className="history-dialog__list">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  aria-selected={selected === entry.id}
                  onClick={() => setSelected(entry.id)}
                >
                  <strong>{formatHistoryDate(entry.createdAt)}</strong>
                  <span>{historyReasonLabel(entry.reason)} · {formatBytes(entry.size)}</span>
                </button>
              ))}
            </div>
            <pre className="history-dialog__preview">
              {version?.content ?? (error ? 'Unable to load this snapshot.' : 'Loading preview…')}
            </pre>
          </div>
        )}
        {error && <div className="dialog__error">{error}</div>}
        {entries.length > 0 && (
          <div className="dialog__actions">
            <span className="history-dialog__warning">The current version will be saved first.</span>
            <button className="btn btn--accent" disabled={!version || restoring} onClick={() => void restore()}>
              {restoring ? 'Restoring…' : 'Restore this version'}
            </button>
          </div>
        )}
      </div>
    </DialogScrim>
  );
}

function historyReasonLabel(reason: NoteHistoryEntry['reason']): string {
  return {
    edit: 'Before edit',
    external: 'External change',
    rename: 'Before rename',
    delete: 'Before deletion',
    restore: 'Before restore',
    sync: 'Replaced by sync',
  }[reason];
}

function formatHistoryDate(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

function bodySelection(
  mode: EditorMode,
  content: string,
  body: string,
  bodyStartLine: number,
  textarea: HTMLTextAreaElement | null,
  liveSelection: TextSelection | null
): TextSelection {
  if (mode === 'live' && liveSelection) return liveSelection;
  if (mode === 'source' && textarea) {
    const bodyStart = offsetAt(content, bodyStartLine, 0);
    if (textarea.selectionStart >= bodyStart) {
      return {
        start: Math.min(body.length, textarea.selectionStart - bodyStart),
        end: Math.min(body.length, textarea.selectionEnd - bodyStart),
      };
    }
  }
  return { start: body.length, end: body.length };
}

/**
 * The rendered text of a block up to the point that was clicked.
 *
 * `caretPositionFromPoint` is the standard spelling and `caretRangeFromPoint`
 * the older WebKit one; Chromium has answered to both for years, so try each.
 */
function renderedTextBeforePoint(container: HTMLElement, x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  // A click that lands on padding rather than on text tells us nothing useful.
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null;

  // Text nodes alone lose the structure: two list items concatenate into one
  // run, and the mapping back to source cannot tell where one ended. Walking
  // elements too puts a newline back at every boundary a reader can see.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let before = '';
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      if (BREAKS_LINE.has((current as Element).tagName) && before && !before.endsWith('\n')) {
        before += '\n';
      }
    } else {
      if (current === node) return before + (current.textContent ?? '').slice(0, offset);
      before += current.textContent ?? '';
    }
    current = walker.nextNode();
  }
  return null;
}

/** Elements whose start is a line break as far as a reader is concerned. */
const BREAKS_LINE = new Set([
  'BR',
  'LI',
  'P',
  'DIV',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

/** Keys that move the caret without changing the text. */
const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function LiveMarkdownEditor({
  body,
  ctx,
  fontSize,
  onChange,
  onBlur,
  onLnCol,
  tags,
  requestedSelection,
  onSelectionChange,
}: {
  body: string;
  ctx: MdContext;
  fontSize: number;
  onChange: (body: string) => void;
  onBlur: () => void;
  onLnCol: (pos: [number, number] | null) => void;
  tags: string[];
  requestedSelection: (TextSelection & { revision: number }) | null;
  onSelectionChange: (selection: TextSelection) => void;
}) {
  // The caret is held as a position in the whole body, not an offset in one
  // block. A keystroke can re-split the blocks under it — pressing Enter is
  // exactly that — and a line and column survive the resplit where a block
  // reference would not.
  const [caret, setCaret] = useState<{ line: number; col: number } | null>(null);
  const [tagRange, setTagRange] = useState<TagCompletionRange | null>(null);
  const [tagSelected, setTagSelected] = useState(0);
  const activeRef = useRef<HTMLTextAreaElement>(null);
  const restoreSelectionRef = useRef<TextSelection | null>(null);
  const blocks = useMemo(() => splitMarkdownBlocks(body), [body]);

  const activeIndex = caret
    ? blocks.findIndex((b) => caret.line >= b.startLine && caret.line <= b.endLine)
    : -1;
  const tagMatches = tagRange ? matchingTags(tags, tagRange.query) : [];

  useEffect(() => {
    if (!requestedSelection) return;
    restoreSelectionRef.current = requestedSelection;
    const position = positionAt(body, requestedSelection.end);
    setCaret(position);
  }, [requestedSelection?.revision]);

  useEffect(() => {
    if (!caret || activeIndex < 0) return;
    const ta = activeRef.current;
    const block = blocks[activeIndex];
    if (!ta || !block) return;
    const blockStart = offsetAt(body, block.startLine, 0);
    const restore = restoreSelectionRef.current;
    const want = offsetAt(block.raw, caret.line - block.startLine, caret.col);
    if (document.activeElement !== ta) ta.focus();
    if (restore && restore.start >= blockStart && restore.end <= blockStart + block.raw.length) {
      ta.setSelectionRange(restore.start - blockStart, restore.end - blockStart);
      restoreSelectionRef.current = null;
    } else if (ta.selectionStart !== want || ta.selectionEnd !== want) {
      ta.setSelectionRange(want, want);
    }
    updateLiveLnCol(ta, ctx.lineOffset + block.startLine, onLnCol);
  }, [caret, activeIndex, blocks, body, ctx.lineOffset, onLnCol]);

  /** Put the caret somewhere in the body, in whichever block now holds it. */
  const moveCaret = (line: number, col: number) => setCaret({ line, col });

  const beginEdit = (block: MarkdownBlock) => {
    const lines = block.raw.split('\n');
    moveCaret(block.startLine + lines.length - 1, lines[lines.length - 1].length);
  };

  /** Open a block for editing with the caret where the reader pointed. */
  const beginEditAt = (block: MarkdownBlock, container: HTMLElement, x: number, y: number) => {
    const shown = renderedTextBeforePoint(container, x, y);
    if (shown === null) {
      beginEdit(block);
      return;
    }
    const pos = positionAt(block.raw, sourceOffsetFromRendered(block.raw, shown));
    moveCaret(block.startLine + pos.line, pos.col);
  };

  /** Apply an edit to one block and land the caret where the edit asked. */
  const applyEdit = (block: MarkdownBlock, edit: { raw: string; caret: number }) => {
    onChange(replaceMarkdownBlock(body, block, edit.raw));
    const pos = positionAt(edit.raw, edit.caret);
    moveCaret(block.startLine + pos.line, pos.col);
  };

  const updateTagCompletion = (value: string, cursor: number) => {
    setTagRange(tagCompletionAt(value, cursor));
    setTagSelected(0);
  };

  const chooseTag = (block: MarkdownBlock, tag: string) => {
    if (!tagRange) return;
    const result = completeTag(block.raw, tagRange, tag);
    setTagRange(null);
    applyEdit(block, { raw: result.text, caret: result.caret });
  };

  const reportSelection = (textarea: HTMLTextAreaElement, block: MarkdownBlock) => {
    const blockStart = offsetAt(body, block.startLine, 0);
    onSelectionChange({
      start: blockStart + textarea.selectionStart,
      end: blockStart + textarea.selectionEnd,
    });
  };

  const commitBlur = () => {
    onLnCol(null);
    onBlur();
  };

  return (
    <div className="editor-body editor-body--live">
      {blocks.map((block, index) => {
        if (index === activeIndex) {
          return (
            <div key={`edit-${block.id}`} className="live-block live-block--active" data-kind={block.kind}>
              <textarea
                ref={activeRef}
                className="live-block__textarea"
                value={block.raw}
                rows={Math.max(2, block.raw.split('\n').length)}
                spellCheck
                style={{ fontSize }}
                onChange={(e) => {
                  const value = e.target.value;
                  const pos = positionAt(value, e.target.selectionStart);
                  onChange(replaceMarkdownBlock(body, block, value));
                  moveCaret(block.startLine + pos.line, pos.col);
                  updateTagCompletion(value, e.target.selectionStart);
                  reportSelection(e.target, block);
                }}
                onClick={(e) => {
                  const pos = positionAt(e.currentTarget.value, e.currentTarget.selectionStart);
                  moveCaret(block.startLine + pos.line, pos.col);
                  updateTagCompletion(e.currentTarget.value, e.currentTarget.selectionStart);
                  reportSelection(e.currentTarget, block);
                }}
                onSelect={(e) => reportSelection(e.currentTarget, block)}
                onKeyUp={(e) => {
                  // Only keys that move the caret without changing the text. A
                  // keyup after an edit would read a block that has already been
                  // re-split and put the caret back where it no longer belongs.
                  if (!CARET_KEYS.has(e.key)) return;
                  const pos = positionAt(e.currentTarget.value, e.currentTarget.selectionStart);
                  moveCaret(block.startLine + pos.line, pos.col);
                  reportSelection(e.currentTarget, block);
                }}
                onKeyDown={(e) => {
                  const ta = e.currentTarget;
                  const at = ta.selectionStart;
                  const collapsed = ta.selectionStart === ta.selectionEnd;

                  if (tagMatches.length > 0) {
                    if (e.key === 'Escape') {
                      setTagRange(null);
                      e.preventDefault();
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      setTagSelected((selected) => Math.min(tagMatches.length - 1, selected + 1));
                      e.preventDefault();
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      setTagSelected((selected) => Math.max(0, selected - 1));
                      e.preventDefault();
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      chooseTag(block, tagMatches[tagSelected]);
                      return;
                    }
                  }

                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setCaret(null);
                    onLnCol(null);
                    onBlur();
                    return;
                  }

                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && collapsed) {
                    e.preventDefault();
                    applyEdit(
                      block,
                      e.shiftKey
                        ? softBreakInBlock(block.kind, ta.value, at)
                        : enterInBlock(block.kind, ta.value, at)
                    );
                    return;
                  }

                  // Backspace at the very top of a block reaches into the one
                  // above it — closing the gap between two blocks, or deleting
                  // a block you opened by accident.
                  if (e.key === 'Backspace' && collapsed && at === 0 && index > 0) {
                    e.preventDefault();
                    const previous = blocks[index - 1];
                    const span = { startLine: previous.startLine, endLine: block.endLine };

                    if (previous.kind === 'blank') {
                      // Remove the paragraph break, so this block joins the one above.
                      onChange(replaceMarkdownBlock(body, span, block.raw));
                      moveCaret(previous.startLine, 0);
                      return;
                    }
                    // Otherwise the two blocks are already adjacent: fold this
                    // one onto the end of the last line above, caret at the seam.
                    const lastLine = previous.raw.split('\n');
                    onChange(replaceMarkdownBlock(body, span, `${previous.raw}${block.raw}`));
                    moveCaret(previous.startLine + lastLine.length - 1, lastLine[lastLine.length - 1].length);
                    return;
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setTagRange(null), 120);
                  commitBlur();
                }}
              />
              {tagMatches.length > 0 && (
                <TagSuggestions tags={tagMatches} selected={tagSelected} onChoose={(tag) => chooseTag(block, tag)} />
              )}
            </div>
          );
        }

        if (block.kind === 'blank') {
          return (
            <button
              key={block.id}
              className="live-block live-block--blank"
              onClick={() => beginEdit(block)}
              type="button"
            >
              Write here
            </button>
          );
        }

        return (
          <div
            key={block.id}
            className="live-block"
            data-kind={block.kind}
            title="Click to edit this Markdown block"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('a, button, input, .checkbox, .attachment-card, .attachment-image')) return;
              beginEditAt(block, e.currentTarget, e.clientX, e.clientY);
            }}
          >
            {renderMarkdown(block.raw, { ...ctx, lineOffset: ctx.lineOffset + block.startLine })}
          </div>
        );
      })}
    </div>
  );
}

function TagSuggestions({
  tags,
  selected,
  onChoose,
}: {
  tags: string[];
  selected: number;
  onChoose: (tag: string) => void;
}) {
  return (
    <div className="tag-suggestions" role="listbox">
      {tags.map((tag, index) => (
        <button
          key={tag}
          type="button"
          role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(tag)}
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}

function updateLiveLnCol(
  textarea: HTMLTextAreaElement,
  startLine: number,
  onLnCol: (pos: [number, number]) => void
) {
  const upto = textarea.value.slice(0, textarea.selectionStart);
  const lines = upto.split('\n');
  onLnCol([startLine + lines.length, lines[lines.length - 1].length + 1]);
}

function FmRow({ k, v, ctx }: { k: string; v: unknown; ctx: MdContext }) {
  const text = Array.isArray(v) ? v.map(String).join(' · ') : String(v);
  return (
    <>
      <div className="k">{k}</div>
      <div className="v">{text}</div>
    </>
  );
}

function AddThread({ path }: { path: string }) {
  const [value, setValue] = useState('');
  const submit = async () => {
    const v = value.trim();
    if (!v) return;
    await api.addTask(path, v);
    setValue('');
  };
  return (
    <div className="add-task-row">
      <span className="checkbox" style={{ opacity: 0.45 }} />
      <input
        value={value}
        placeholder="Add a thread — becomes a task everywhere…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      {value.trim() && (
        <button className="btn btn--ghost" onClick={() => void submit()}>
          ↵ add
        </button>
      )}
    </div>
  );
}
