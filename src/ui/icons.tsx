import type { ReactNode } from 'react';

// Tiny lucide-ish monoline icon set.

const PATHS: Record<string, ReactNode> = {
  files: (
    <>
      <path d="M4 4h7l2 2.4V20H4z" />
      <path d="M14 8h6V20h-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4-4" />
    </>
  ),
  tasks: (
    <>
      <path d="M4 7h2l1.4 1.6L10 5" />
      <path d="M13 7h7" />
      <path d="M4 14h2l1.4 1.6L10 12" />
      <path d="M13 14h7" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <circle cx="11" cy="18" r="2.2" />
      <path d="M8 8l8 1M16 11l-4 5M9 16l-2-7" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  sync: (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" />
      <path d="M4 20v-4h4" />
    </>
  ),
  folder: <path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="m14 6 4 4" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
      <path d="M12 15v6" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  // Chevrons pushing apart / pulling together — unfold and fold.
  expand: <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
  collapse: <path d="m8 5 4 4 4-4M8 19l4-4 4 4" />,
  focus: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </>
  ),
  calendarPlus: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M12 12v5M9.5 14.5h5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 13v6H5V5h6" />
    </>
  ),
  // Window controls are drawn at 10px on a 24px grid, square and centred, the
  // way Windows and most Linux desktops draw them.
  winMinimize: <path d="M7 12h10" />,
  winMaximize: <rect x="7" y="7" width="10" height="10" rx="1" />,
  winRestore: (
    <>
      <rect x="7" y="9" width="8" height="8" rx="1" />
      <path d="M9.5 9V7.5A.5.5 0 0 1 10 7h6.5a.5.5 0 0 1 .5.5V14a.5.5 0 0 1-.5.5H15" />
    </>
  ),
  winClose: <path d="m7.5 7.5 9 9M16.5 7.5l-9 9" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
