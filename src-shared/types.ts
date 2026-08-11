// Shared types between the Electron main process and the renderer.

export type SchemaName =
  | 'Note'
  | 'Project'
  | 'Person'
  | 'Daily'
  | 'Idea'
  | 'Source'
  | 'Code'
  | 'Place';

export const SCHEMA_NAMES: SchemaName[] = [
  'Note',
  'Project',
  'Person',
  'Daily',
  'Idea',
  'Source',
  'Code',
  'Place',
];

export type TaskStatus = 'open' | 'working' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'med' | 'high';

export interface TaskItem {
  /** `${notePath}#L${line}` — stable within one snapshot */
  id: string;
  notePath: string;
  noteTitle: string;
  /** 1-based line number in the note file */
  line: number;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string | null; // YYYY-MM-DD
  tags: string[];
}

export interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

export interface BacklinkRef {
  path: string;
  title: string;
  schema: SchemaName;
  folder: string;
  snippet: string;
  updated: number;
}

export interface NoteMeta {
  /** vault-relative path, also the note id */
  path: string;
  title: string;
  /** top-level folder ('' for vault root) */
  folder: string;
  schema: SchemaName;
  tags: string[];
  frontmatter: Record<string, unknown>;
  /** resolved outgoing wikilink paths */
  links: string[];
  /** wikilink names that resolve to no note */
  unresolved: string[];
  headings: HeadingItem[];
  excerpt: string;
  wordCount: number;
  taskCount: number;
  openTaskCount: number;
  created: number;
  updated: number;
}

export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  notes: string[]; // note paths
}

export interface GraphNode {
  path: string;
  label: string;
  schema: SchemaName;
  folder: string;
  deg: number;
  x: number;
  y: number;
  updated: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: [string, string][];
}

export interface ActivityEvent {
  kind: 'note' | 'task';
  verb: string;
  title: string;
  ref: string;
  ts: number;
}

export interface VaultStats {
  notes: number;
  folders: number;
  tasksOpen: number;
  tasksTotal: number;
  overdue: number;
  wikilinks: number;
  resolved: number;
  orphans: number;
}

export interface VaultSettings {
  theme: 'midnight' | 'slate' | 'light';
  density: 'compact' | 'regular' | 'cozy';
  logoVariant: 'sigil' | 'monogram' | 'bracket';
  marginOn: boolean;
  pinnedNote: string | null;
  dailyFolder: string;
  attachmentsFolder: string;
  editorFontSize: number;
  autosaveMs: number;
  savedSearches: SavedSearch[];
  schemaTemplates: Partial<Record<SchemaName, string>>;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  theme: 'midnight',
  density: 'regular',
  logoVariant: 'sigil',
  marginOn: true,
  pinnedNote: null,
  dailyFolder: 'Daily',
  attachmentsFolder: 'Attachments',
  editorFontSize: 15,
  autosaveMs: 800,
  savedSearches: [],
  schemaTemplates: {},
};

export interface VaultSnapshot {
  vaultPath: string;
  vaultName: string;
  tree: FolderNode;
  notes: NoteMeta[];
  tasks: TaskItem[];
  stats: VaultStats;
  graph: GraphData;
  activity: ActivityEvent[];
  settings: VaultSettings;
}

export interface NotePayload {
  meta: NoteMeta;
  /** full raw file content, frontmatter included */
  content: string;
  /** body only (frontmatter stripped) */
  body: string;
  /** line offset of the body within the raw content */
  bodyStartLine: number;
  backlinks: BacklinkRef[];
  attachments: AttachmentRef[];
}

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'file';

export interface AttachmentRef {
  /** Target exactly as written in Markdown. */
  target: string;
  /** Resolved vault-relative path, or null when the target escapes the vault. */
  path: string | null;
  label: string;
  embedded: boolean;
  exists: boolean;
  mime: string;
  kind: AttachmentKind;
  size: number | null;
}

export interface AttachmentImportResult {
  path: string;
  name: string;
  mime: string;
  kind: AttachmentKind;
  markdown: string;
}

export type NoteHistoryReason = 'edit' | 'external' | 'rename' | 'delete' | 'restore' | 'sync';

export interface NoteHistoryEntry {
  /** Snapshot filename; opaque outside the main process. */
  id: string;
  notePath: string;
  createdAt: number;
  size: number;
  reason: NoteHistoryReason;
}

export interface NoteHistoryVersion extends NoteHistoryEntry {
  content: string;
}

/** One path changed by a filesystem operation. Used to keep renderer state in sync. */
export interface PathChange {
  oldPath: string;
  newPath: string;
}

export interface SearchResult {
  path: string;
  title: string;
  schema: SchemaName;
  folder: string;
  tags: string[];
  snippet: string;
  /** 1-based line and column in the complete Markdown file. */
  line: number;
  column: number;
  length: number;
  score: number;
  updated: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
}

export interface DeletedNoteEntry {
  path: string;
  title: string;
  schema: SchemaName;
  deletedAt: number;
  size: number;
}
