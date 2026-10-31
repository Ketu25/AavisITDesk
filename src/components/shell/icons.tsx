type IconProps = { className?: string };

const base = "size-[1.05rem] flex-none";

export const Icons = {
  overview: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <rect x="2.6" y="2.6" width="6" height="6" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.4" y="2.6" width="6" height="6" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.6" y="11.4" width="6" height="6" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.4" y="11.4" width="6" height="6" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  ticket: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path
        d="M3 6.2c0-1 .8-1.7 1.7-1.7h10.6c1 0 1.7.8 1.7 1.7v1.4a2.4 2.4 0 0 0 0 4.8v1.4c0 1-.8 1.7-1.7 1.7H4.7c-1 0-1.7-.8-1.7-1.7v-1.4a2.4 2.4 0 0 0 0-4.8V6.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M11.6 7.2v5.6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.8" strokeLinecap="round" />
    </svg>
  ),
  queue: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M3 5.2h14M3 10h14M3 14.8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  reports: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="4" y="9" width="3" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.5" y="5.5" width="3" height="8.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="11" width="3" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  people: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="8" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 16.2c.4-2.6 2.5-4.2 5.2-4.2s4.8 1.6 5.2 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 5.6a2.5 2.5 0 0 1 0 4.8M15.4 12.4c1.3.6 2.2 1.9 2.4 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  building: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M3.5 16.5V5.2c0-.7.5-1.2 1.2-1.2h5c.7 0 1.2.5 1.2 1.2v11.3M11 16.5V9h4.3c.7 0 1.2.5 1.2 1.2v6.3M2.5 16.5h15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7h2M6 10h2M6 13h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  clock: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.2V10l2.6 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  route: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7.2v3.3c0 1.4 1.1 2.5 2.5 2.5h5.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  settings: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2.6v1.7M10 15.7v1.7M17.4 10h-1.7M4.3 10H2.6M15.2 4.8l-1.2 1.2M6 14l-1.2 1.2M15.2 15.2 14 14M6 6 4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  plus: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  more: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className ?? "size-4 flex-none"} aria-hidden>
      <circle cx="4.5" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="15.5" cy="10" r="1.5" />
    </svg>
  ),
  grip: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className ?? "size-4 flex-none"} aria-hidden>
      <circle cx="7.5" cy="5" r="1.4" />
      <circle cx="12.5" cy="5" r="1.4" />
      <circle cx="7.5" cy="10" r="1.4" />
      <circle cx="12.5" cy="10" r="1.4" />
      <circle cx="7.5" cy="15" r="1.4" />
      <circle cx="12.5" cy="15" r="1.4" />
    </svg>
  ),
  chevronUp: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="m5.5 12.2 4.5-4.5 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronDown: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="m5.5 7.8 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowLeft: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M15.5 10h-11m4.4-4.4L4.5 10l4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowRight: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M4.5 10h11m-4.4-4.4 4.4 4.4-4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <circle cx="9" cy="9" r="5.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.2 13.2 3.1 3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  close: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="m5.8 5.8 8.4 8.4M14.2 5.8l-8.4 8.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  inbox: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M2.8 11.5h3.4l1.1 2h5.4l1.1-2h3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 4.2h10.8l1.8 7.3v3.1c0 .8-.7 1.5-1.5 1.5H4.3c-.8 0-1.5-.7-1.5-1.5v-3.1L4.6 4.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  check: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="m4.5 10.4 3.4 3.4 7.6-7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pause: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.3 7.5v5M11.7 7.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  refresh: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M16.2 8.6A6.4 6.4 0 0 0 5.1 5.8M3.8 11.4a6.4 6.4 0 0 0 11.1 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.5 4.6v4h-4M3.5 15.4v-4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  download: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M10 3.6v8.6M6.4 8.8 10 12.4l3.6-3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.6h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  // -- quick-ticket groups (QUICK_TICKET_ICONS) ------------------------------
  bolt: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M11.2 2.8 4.6 11.2h4.8l-.6 6 6.6-8.4h-4.8l.6-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  printer: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M6 7.4V3.8c0-.5.4-.8.8-.8h6.4c.4 0 .8.3.8.8v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 14.2H4.4c-.8 0-1.4-.6-1.4-1.4V8.8c0-.8.6-1.4 1.4-1.4h11.2c.8 0 1.4.6 1.4 1.4v4c0 .8-.6 1.4-1.4 1.4H14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="6" y="11.4" width="8" height="5.6" rx=".8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.6 9.8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  folder: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M2.8 6.1c0-.9.7-1.6 1.6-1.6h3.2l1.7 1.9h6.3c.9 0 1.6.7 1.6 1.6v6.4c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6V6.1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2.8 9h14.4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  wifi: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M2.6 7.6a10.4 10.4 0 0 1 14.8 0M5.2 10.3a6.7 6.7 0 0 1 9.6 0M7.8 13a3.1 3.1 0 0 1 4.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 15.9h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  mail: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <rect x="2.8" y="4.4" width="14.4" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="m3.6 5.6 6.4 5 6.4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  monitor: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <rect x="2.6" y="3.4" width="14.8" height="10.2" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.2 16.6h5.6M10 13.6v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  phone: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M5.3 3.2h2.1l1.2 3.1-1.5 1c.8 1.8 2 3 3.7 3.7l1-1.5 3.1 1.2v2.1c0 .9-.7 1.6-1.6 1.6A11.3 11.3 0 0 1 3.7 4.8c0-.9.7-1.6 1.6-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  key: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <circle cx="7" cy="12.8" r="3.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="m9.4 10.4 7-7M14 5.8l1.9 1.9M12.2 7.6l1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  shield: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M10 2.8 4.2 5v4.5c0 3.6 2.4 6.3 5.8 7.7 3.4-1.4 5.8-4.1 5.8-7.7V5L10 2.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m7.6 10 1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  app: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <rect x="2.8" y="3.6" width="14.4" height="12.8" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 7.2h14.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.4 5.4h.01M7.4 5.4h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  wrench: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M12.7 3.1a3.9 3.9 0 0 0-4 5.2l-5.3 5.3a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a3.9 3.9 0 0 0 5.2-4l-2.3 2.3-2-.5-.5-2 2.3-2.3h-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  qr: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <rect x="3" y="3" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11.6" y="3" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11.6" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11.8 11.8h1.6M16.2 11.8v1.6M11.8 15.2v2M14.6 16.4h2.4M14.6 14.2h.01"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  pin: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path
        d="M10 17.4s-5.2-4.7-5.2-8.9a5.2 5.2 0 0 1 10.4 0c0 4.2-5.2 8.9-5.2 8.9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.5" r="1.9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  alert: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M10 7.2v3.4m0 2.6h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.6 3.4 2.5 14.2c-.6 1 .2 2.3 1.4 2.3h12.2c1.2 0 2-1.3 1.4-2.3L11.4 3.4a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
