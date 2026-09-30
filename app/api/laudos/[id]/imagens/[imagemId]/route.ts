import { NextResponse } from "next/server";
import { erro, tratarErro } from "@/lib/api";
import { confirmarImagem, rascunhoDoAutor, removerImagem } from "@/lib/laudos";
import { usuarioLiberado } from "@/lib/sessao";

export const runtime = "nodejs";
export const maxDuration = 30;

type Contexto = { params: Promise<{ id: string; imagemId: string }> };

/** O envio da foto terminou: o servidor a processa e devolve a miniatura. */
export async function POST(_req: Request, { params }: Contexto) {
  const { id, imagemId } = await params;
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    await rascunhoDoAutor(id, autor.id);
    return NextResponse.json(await confirmarImagem(id, imagemId));
  } catch (e) {
    return tratarErro(e);
  }
}

/** Remove uma foto do rascunho antes de emitir o laudo. */
export async function DELETE(_req: Request, { params }: Contexto) {
  const { id, imagemId } = await params;
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    await rascunhoDoAutor(id, autor.id);
    await removerImagem(id, imagemId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return tratarErro(e);
  }
}
