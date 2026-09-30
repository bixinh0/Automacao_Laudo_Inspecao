import { NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { atualizarRascunho, buscarLaudo, fotosDoRascunho, rascunhoDoAutor } from "@/lib/laudos";
import { lerDadosLaudo } from "@/lib/regras";
import { usuarioLiberado } from "@/lib/sessao";

export const runtime = "nodejs";

type Contexto = { params: Promise<{ id: string }> };

/** Estado do rascunho para a tela de envio retomar depois de recarregar: OP, observações e fotos. */
export async function GET(_req: Request, { params }: Contexto) {
  const { id } = await params;
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    const laudo = await buscarLaudo(id);
    if (laudo?.criadoPor === autor.id && laudo.caminhoPdf) return NextResponse.json({ id, emitido: true });
    const rascunho = await rascunhoDoAutor(id, autor.id);
    return NextResponse.json({
      id,
      emitido: false,
      numeroOP: rascunho.numeroOP,
      observacoes: rascunho.observacoes ?? "",
      fotos: await fotosDoRascunho(id),
    });
  } catch (e) {
    return tratarErro(e);
  }
}

/** Atualiza OP e observações do rascunho enquanto a pessoa digita. */
export async function PATCH(req: Request, { params }: Contexto) {
  const { id } = await params;
  const dados = lerDadosLaudo(await lerJson(req));
  if ("erro" in dados) return erro(dados.erro);
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    await atualizarRascunho(await rascunhoDoAutor(id, autor.id), dados);
    return NextResponse.json({ id });
  } catch (e) {
    return tratarErro(e);
  }
}
