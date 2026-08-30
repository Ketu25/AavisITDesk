import { cn, hueFromId, initials } from "@/lib/utils";

export function Avatar({
  name,
  id,
  size = "md",
  className,
}: {
  name: string;
  id: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const hue = hueFromId(id);
  const dims = {
    xs: "size-5 text-[0.5625rem]",
    sm: "size-6 text-[0.625rem]",
    md: "size-8 text-[0.6875rem]",
    lg: "size-11 text-sm",
  }[size];

  return (
    <span
      title={name}
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full font-semibold",
        "ring-1 ring-inset ring-black/5 dark:ring-white/10",
        dims,
        className,
      )}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 58%), hsl(${(hue + 42) % 360} 66% 48%))`,
        color: "white",
      }}
    >
      {initials(name)}
    </span>
  );
}
