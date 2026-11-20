import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OM Terminal | Portfolio Tracker",
  description: "A personal portfolio terminal for tracking positions, performance and cash.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
