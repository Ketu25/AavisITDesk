import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

/**
 * The signed-out screens. The theme button lives here rather than in
 * <AuthShell> because the Worker bundles a separate server copy of what each
 * page imports, but only one of what a layout imports — from the shell it was
 * copied five times over.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Out in the corner rather than in the card: it changes the whole
          screen, not the form. After the page in the markup, so Tab reaches
          the form first. Being here also means a first visit adopts the OS
          theme before sign-in, not only after it. */}
      <AnimatedThemeToggler className="absolute right-3 top-3 z-10 sm:right-5 sm:top-5" />
    </>
  );
}
