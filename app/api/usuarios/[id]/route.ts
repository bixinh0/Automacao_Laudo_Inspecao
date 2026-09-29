import { NextResponse } from "next/server";
import { erro, lerJson } from "@/lib/api";
import { ACOES, podeGerenciar, type AcaoUsuario } from "@/lib/permissoes";
import { usuarioLiberado } from "@/lib/sessao";
import { ErroConta, executarAcao } from "@/lib/usuarios";

export const runtime = "nodejs";

/**
 * Ações da gestão de usuários: { acao: APROVAR | RECUSAR | SUSPENDER | PROMOVER |
 * REBAIXAR | EDITAR | REDEFINIR_SENHA | REMOVER, motivo?, nome?, departamento? }.
 * O papel de quem chama é conferido aqui em toda requisição; sem permissão → 403.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const eu = await usuarioLiberado();
  if (!eu) return erro("Sessão expirada. Entre novamente.", 401);
  if (!podeGerenciar(eu)) return erro("Apenas OWNER e ADMIN podem gerenciar usuários.", 403);

  const { id } = await params;
  const corpo = await lerJson(req);
  const acao = String(corpo.acao ?? "") as AcaoUsuario;
  if (!ACOES.includes(acao)) return erro("Ação inválida.");
  try {
    const resultado = await executarAcao(eu, id, acao, {
      motivo: corpo.motivo ? String(corpo.motivo) : undefined,
      nome: corpo.nome !== undefined ? String(corpo.nome) : undefined,
      departamento: corpo.departamento !== undefined ? String(corpo.departamento) : undefined,
    });
    // A senha provisória vai só nesta resposta; nada de cache.
    return NextResponse.json({ ok: true, ...resultado }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErroConta) return erro(e.message, e.status);
    console.error(`Gestão de usuários (${acao}):`, e);
    return erro("Não foi possível concluir a ação agora. Tente novamente.", 500);
  }
}
