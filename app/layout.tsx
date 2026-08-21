import type { Metadata } from "next";
import "./globals.css";
import "./dialogs.css";
import "./modeling.css";

export const metadata: Metadata = {
  title: "Basic CAD — Parametric solid modeling",
  description: "A local-first, browser-driven parametric CAD workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
