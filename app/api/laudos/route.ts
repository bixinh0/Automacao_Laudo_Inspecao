import { NextResponse } from "next/server";
import { erro, lerJson, tratarErro } from "@/lib/api";
import { criarRascunho } from "@/lib/laudos";
import { lerDadosLaudo } from "@/lib/regras";
import { usuarioLiberado } from "@/lib/sessao";

export const runtime = "nodejs";

/** Cria o laudo como rascunho assim que a OP é informada. As fotos são vinculadas depois, uma a uma. */
export async function POST(req: Request) {
  const dados = lerDadosLaudo(await lerJson(req));
  if ("erro" in dados) return erro(dados.erro);
  const autor = await usuarioLiberado();
  if (!autor) return erro("Sessão expirada. Entre novamente.", 401);
  try {
    const laudo = await criarRascunho(dados.numeroOP, dados.observacoes, autor);
    return NextResponse.json({ id: laudo.id }, { status: 201 });
  } catch (e) {
    return tratarErro(e);
  }
}
