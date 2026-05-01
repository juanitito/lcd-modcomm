import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LCD ModComm",
  description: "Lascia Corre Distribution — module commande & facturation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
