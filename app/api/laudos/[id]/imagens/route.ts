import { NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { rascunhoDoAutor, reservarImagens } from "@/lib/laudos";
import { limiteFotos, TIPOS, type TipoImagem } from "@/lib/regras";
import { usuarioLiberado } from "@/lib/sessao";

export const runtime = "nodejs";

/**
 * Reserva fotos no rascunho, na ordem em que foram escolhidas, e devolve uma
 * URL de envio assinada para cada uma (o navegador envia direto ao Storage).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corpo = await lerJson(req);
  const tipo = corpo.tipo as TipoImagem;
  const quantidade = Number(corpo.quantidade);
  if (!TIPOS.includes(tipo)) return erro("Tipo de foto inválido.");
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > limiteFotos(tipo)) return erro("Quantidade de fotos inválida.");
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    await rascunhoDoAutor(id, autor.id);
    return NextResponse.json({ envios: await reservarImagens(id, tipo, quantidade) }, { status: 201 });
  } catch (e) {
    return tratarErro(e);
  }
}
