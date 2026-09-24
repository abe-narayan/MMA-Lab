/**
 * ICONS — a small, consistent inline-SVG set (24 px grid, 1.75 stroke,
 * currentColor). Inline so the app stays one self-contained bundle with no
 * network; decorative by default (`aria-hidden`), because every place an
 * icon appears also carries a text label or an aria-label.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function make(paths: JSX.Element, name: string) {
  const Icon = ({ title, ...props }: IconProps): JSX.Element => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {paths}
    </svg>
  );
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconMatch = make(<><path d="M5 19 19 5" /><path d="M15 5h4v4" /><path d="M5 5l6 6" /><path d="M5 9V5h4" /><path d="m14 14 5 5" /></>, 'Match');
export const IconBatch = make(<><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="18" height="4" rx="1" /><rect x="3" y="16" width="18" height="4" rx="1" /></>, 'Batch');
export const IconTrophy = make(<><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5a3 3 0 0 0 3 4" /><path d="M16 6h3a3 3 0 0 1-3 4" /><path d="M12 13v4" /><path d="M8 20h8" /></>, 'Trophy');
export const IconPlay = make(<><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5v-7Z" /></>, 'Play');
export const IconResult = make(<><path d="M6 3h9l3 3v15H6z" /><path d="M9 11h6" /><path d="M9 15h6" /><path d="M9 7h3" /></>, 'Result');
export const IconHistory = make(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></>, 'History');
export const IconUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6 6 0 0 1 3 6" /></>, 'Users');
export const IconEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>, 'Edit');
export const IconBook = make(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13" /><path d="M9 7h6" /></>, 'Book');
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, 'Sun');
export const IconMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />, 'Moon');
export const IconMonitor = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>, 'Monitor');
export const IconSidebar = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>, 'Sidebar');
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, 'Search');
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'Plus');
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />, 'X');
export const IconDownload = make(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>, 'Download');
export const IconUpload = make(<><path d="M12 20V9" /><path d="m7 14 5-5 5 5" /><path d="M5 4h14" /></>, 'Upload');
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>, 'Copy');
export const IconTrash = make(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>, 'Trash');
export const IconUndo = make(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>, 'Undo');
export const IconDice = make(<><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></>, 'Dice');
export const IconAlert = make(<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>, 'Alert');
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>, 'Info');
export const IconCheck = make(<path d="m5 12 5 5 9-10" />, 'Check');
export const IconCompare = make(<><path d="M8 3v18" /><path d="M16 3v18" /><path d="M3 8h5M16 8h5M3 16h5M16 16h5" /></>, 'Compare');
export const IconSliders = make(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>, 'Sliders');
export const IconStop = make(<rect x="6" y="6" width="12" height="12" rx="2" />, 'Stop');
export const IconChevron = make(<path d="m9 6 6 6-6 6" />, 'Chevron');
export const IconFlask = make(<><path d="M9 3h6" /><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7.5 15h9" /></>, 'Flask');
