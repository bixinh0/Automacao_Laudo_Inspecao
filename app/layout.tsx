import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Laudo de Inspeção",
  description: "Monta o laudo de inspeção de produção (FM PRO 001 01) em PDF a partir das fotos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12355b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="topo">
          <Link href="/" className="marca">
            Laudo de Inspeção
          </Link>
          <nav>
            <Link href="/">Novo</Link>
            <Link href="/historico">Histórico</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
