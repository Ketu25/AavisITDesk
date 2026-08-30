import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl",
        className,
      )}
    >
      {/* Left padding clears the mobile menu button until the sidebar
          appears at lg. Kept off the `px` shorthand so the wider `sm`
          padding cannot override it. */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 pr-4 pl-14 sm:pr-6 lg:pl-6">
        <div className="min-w-0">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[80rem] flex-1 px-4 py-5 sm:px-6", className)}>
      {children}
    </div>
  );
}
