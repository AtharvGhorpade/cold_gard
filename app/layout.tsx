import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StayCold · Cold Chain Monitor",
  description: "Real-time vaccine cold chain integrity monitoring",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
