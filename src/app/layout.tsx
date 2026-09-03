import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

/**
 * Plex Mono does the talking. Every number, code and label is set in it, which
 * makes the interface read like an instrument panel rather than a web form —
 * apt for a plant where everything already carries a batch code and a
 * timestamp. Plex Sans handles prose so the mono stays a deliberate signal.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Aavis IT Desk", template: "%s · Aavis IT Desk" },
  description: "Internal IT support desk for Aavis Pharma.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e12" },
  ],
};

/**
 * The theme is resolved on the server from a cookie and written straight onto
 * <html>, so the first paint is already correct. That avoids both the flash of
 * the wrong theme and the inline bootstrap script a client-side read needs —
 * a <script> inside the React tree logs a warning on every render.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value;

  return (
    <html lang="en" className={theme === "light" ? undefined : "dark"} suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
