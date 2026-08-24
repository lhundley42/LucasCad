import type { Metadata } from "next";
import "./globals.css";
import "./dialogs.css";
import "./modeling.css";

export const metadata: Metadata = {
  title: "LucasCad — Parametric solid modeling",
  description: "LucasCad is a local-first, browser-driven parametric CAD workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
