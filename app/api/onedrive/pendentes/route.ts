import { NextResponse } from "next/server";
import { enviarLaudoAoOneDrive, listarPendentesOneDrive } from "@/lib/laudos";

export const runtime = "nodejs";
export const maxDuration = 60;

// Um lote por clique, para caber no tempo máximo da função; o botão pode ser usado de novo.
const POR_LOTE = 15;

/** Envia ao OneDrive os laudos que ficaram pendentes (falha de rede, emitidos antes da conexão…). */
export async function POST(req: Request) {
  const pendentes = await listarPendentesOneDrive(POR_LOTE);
  let enviados = 0;
  for (const laudo of pendentes) if (await enviarLaudoAoOneDrive(laudo.id)) enviados++;
  const url = new URL("/onedrive", req.url);
  url.searchParams.set("enviados", String(enviados));
  url.searchParams.set("falhas", String(pendentes.length - enviados));
  return NextResponse.redirect(url, 303);
}
