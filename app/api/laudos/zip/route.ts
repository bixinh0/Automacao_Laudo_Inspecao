import { NextResponse } from "next/server";
import { erro, tratarErro } from "@/lib/api";
import { linksParaZip, listarLaudosDoDia } from "@/lib/laudos";
import { pastaDoDia } from "@/lib/pdf/formato";

export const runtime = "nodejs";

/**
 * Lista os PDFs de um dia (?data=AAAA-MM-DD) com links temporários. O ZIP é
 * montado no navegador: os arquivos vêm direto do Storage, sem passar pelo
 * limite de 4,5 MB de resposta da Vercel.
 */
export async function GET(req: Request) {
  const dia = new URL(req.url).searchParams.get("data") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia))) return erro("Data inválida.");
  try {
    const laudos = await listarLaudosDoDia(dia);
    return NextResponse.json({ pasta: pastaDoDia(dia), arquivos: await linksParaZip(laudos) });
  } catch (e) {
    return tratarErro(e);
  }
}
