import { NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { processarImagemEnviada } from "@/lib/laudos";
import { TIPOS, type TipoImagem } from "@/lib/regras";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Processa uma foto recém-enviada ao Storage (rotação EXIF, redução, JPEG, SHA-256). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corpo = await lerJson(req);
  const tipo = corpo.tipo as TipoImagem;
  const ordem = Number(corpo.ordem);
  if (!TIPOS.includes(tipo) || !Number.isInteger(ordem) || ordem < 1) return erro("Foto inválida.");

  try {
    const imagem = await processarImagemEnviada(id, tipo, ordem);
    return NextResponse.json({ id: imagem.id, hashSha256: imagem.hashSha256 });
  } catch (e) {
    return tratarErro(e);
  }
}
