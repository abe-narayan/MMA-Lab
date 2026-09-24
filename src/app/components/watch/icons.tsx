/**
 * Transport icons for the Watch screen, drawn like the design system's set
 * (src/app/ui/icons.tsx: 24 px grid, 1.75 stroke, currentColor, decorative).
 * Kept here because the shared icon file belongs to the design system.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function icon(paths: JSX.Element, name: string, filled = false) {
  const I = (props: P): JSX.Element => (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {paths}
    </svg>
  );
  I.displayName = `Watch${name}`;
  return I;
}

export const IconPlayFilled = icon(<path d="M7 4.5v15l12-7.5-12-7.5Z" />, 'Play', true);
export const IconPause = icon(<><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>, 'Pause', true);
export const IconRestart = icon(<><path d="M6 5v14" /><path d="M19 5v14L9 12l10-7Z" /></>, 'Restart');
export const IconStepBack = icon(<><path d="M16 6 10 12l6 6" /><path d="M7 6v12" /></>, 'StepBack');
export const IconStepFwd = icon(<><path d="m8 6 6 6-6 6" /><path d="M17 6v12" /></>, 'StepFwd');
export const IconFullscreen = icon(<><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>, 'Fullscreen');
export const IconExitFullscreen = icon(<><path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" /></>, 'ExitFullscreen');
export const IconKeyboard = icon(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></>, 'Keyboard');
export const IconCamera = icon(<><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, 'Camera');
export const IconReplay = icon(<><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4h4" /><path d="m10.5 9.5 4 2.5-4 2.5v-5Z" /></>, 'Replay');
export const IconSave = icon(<><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4" /><path d="M8 20v-6h8v6" /></>, 'Save');
export const IconFolder = icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />, 'Folder');
export const IconChart = icon(<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-3" /></>, 'Chart');
export const IconLoop = icon(<><path d="M17 3l3 3-3 3" /><path d="M4 12V9a3 3 0 0 1 3-3h13" /><path d="M7 21l-3-3 3-3" /><path d="M20 12v3a3 3 0 0 1-3 3H4" /></>, 'Loop');
export const IconGear = icon(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>, 'Gear');
