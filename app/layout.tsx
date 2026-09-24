import type { Metadata, Viewport } from "next";
import { CODIGO_LAUDO, TITULO_LAUDO } from "@/lib/regras";
import "./globals.css";

export const metadata: Metadata = {
  title: "Laudo de Inspeção · Vanderhulst",
  description: `Monta o ${TITULO_LAUDO} (${CODIGO_LAUDO}) em PDF a partir das fotos.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2399D6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
