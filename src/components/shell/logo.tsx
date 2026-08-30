import { cn } from "@/lib/utils";

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("flex-none", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="aavis-mark" x1="4" y1="3" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B6BFF" />
          <stop offset="1" stopColor="#4C2FD6" />
        </linearGradient>
      </defs>
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="8.75" fill="url(#aavis-mark)" />
      <path
        d="M10 22.25 15.1 9.9a1 1 0 0 1 1.85 0L22 22.25"
        stroke="white"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.9 18.15h6.25" stroke="white" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size={26} />
      <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">
        Aavis <span className="text-ink-muted">IT&nbsp;Desk</span>
      </span>
    </span>
  );
}
