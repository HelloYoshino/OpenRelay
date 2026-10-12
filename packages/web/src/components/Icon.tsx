import type { SVGProps } from 'react';

/** Stroke icons on a 24×24 grid. */
const PATHS = {
  overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v3h6V4zM4 17v3h6v-3z',
  incident: 'M12 3 2.5 19.5h19zM12 9.5v4.5M12 17h.01',
  events: 'M3 12h4l3-8 4 16 3-8h4',
  routing: 'M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M6 21v-6M18 3v3M15 6h6M3 18h6',
  channels: 'M4 5h16v11H8l-4 4zM8 9.5h8M8 12.5h5',
  escalation: 'M4 20h4v-5h4v-5h4V5h4',
  silence: 'M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6',
  topology:
    'M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5 16a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM19 16a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM10.8 7.8 6.2 16.2M13.2 7.8l4.6 8.4',
  deliveries: 'M3 11.5 21 3l-8.5 18-2-7.5zM10.5 13.5 21 3',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  bellOff: 'M8.7 3.2A6 6 0 0 1 18 8c0 3.6.8 5.9 1.6 7.3M17 17H3s3-2 3-9c0-.8.1-1.6.4-2.3M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8.5 12.5l2.5 2.5 4.5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  right: 'M9 18l6-6-6-6',
  left: 'M15 18l-6-6 6-6',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-5-5',
  comment: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M6 21V9M15 12l3 3-3 3',
  detach: 'M8 12h8M3 7v10M21 7v10M7 8l-4 4 4 4M17 8l4 4-4 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  flash: 'M13 2 4 14h7l-1 8 9-12h-7z',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 3h16',
  play: 'M7 4v16l13-8z',
  wave: 'M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0',
  key: 'M15 3a6 6 0 1 1-5.6 8.2L3 17.5V21h3.5v-2h2v-2h2l1.5-1.5A6 6 0 0 1 15 3zM16.5 7.5h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01',
  alert: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V13M12 16.5h.01',
  storm: 'M7 16a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.5 9 4 4 0 0 1 18 16.5M13 12l-3 5h4l-3 5',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  eyeOff:
    'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  filter: 'M3 4h18l-7 9v6l-4 2v-8z',
  target: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 11.5v1',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className="icon"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
