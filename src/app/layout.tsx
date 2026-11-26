import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: {
    default: "HookTrace",
    template: "%s · HookTrace",
  },
  description:
    "A webhook debugger for Stripe, GitHub, and Razorpay. Capture the raw request, see why the signature failed, and replay it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable} ${display.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
