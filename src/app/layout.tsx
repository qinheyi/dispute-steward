import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeSteward — PayPal AI Hackathon",
  description:
    "AI steward that triages PayPal disputes and invoices, drafts replies, and stages sandbox refunds for human approval.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased desk-bg">{children}</body>
    </html>
  );
}
