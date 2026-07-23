import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import ServiceWorkerRegistrar from "@/components/layout/ServiceWorkerRegistrar";
import ChatProvider from "@/components/agent/ChatProvider";
import FloatingChat from "@/components/agent/FloatingChat";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Cadence",
  description: "Your daily productivity rhythm",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cadence",
  },
};

export const viewport: Viewport = {
  themeColor: "#7c6cff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} h-full`}>
      <body className="min-h-full">
        <ServiceWorkerRegistrar />
        {/* Chat state must live above the pages so it survives navigation. */}
        <ChatProvider>
          {children}
          <FloatingChat />
        </ChatProvider>
      </body>
    </html>
  );
}
