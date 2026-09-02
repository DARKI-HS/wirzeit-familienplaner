import type { Metadata } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "WirZeit – Familienplaner",
  description: "Gemeinsamer Kalender, Erinnerungen und Familienchat.",
  icons: {
    icon: [{ url: `${basePath}/favicon-32.png`, sizes: "32x32", type: "image/png" }],
    shortcut: `${basePath}/favicon-32.png`,
    apple: [{ url: `${basePath}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "WirZeit", statusBarStyle: "default" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
