import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Aavis IT Desk", template: "%s · Aavis IT Desk" },
  description: "Internal IT support desk for Aavis Pharma.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#08080c" },
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
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
