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
  search: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <circle cx="9" cy="9" r="5.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.2 13.2 3.1 3.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
  refresh: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? "size-4 flex-none"} aria-hidden>
      <path d="M16.2 8.6A6.4 6.4 0 0 0 5.1 5.8M3.8 11.4a6.4 6.4 0 0 0 11.1 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.5 4.6v4h-4M3.5 15.4v-4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  alert: ({ className }: IconProps) => (
    <svg viewBox="0 0 20 20" fill="none" className={className ?? base} aria-hidden>
      <path d="M10 7.2v3.4m0 2.6h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.6 3.4 2.5 14.2c-.6 1 .2 2.3 1.4 2.3h12.2c1.2 0 2-1.3 1.4-2.3L11.4 3.4a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
