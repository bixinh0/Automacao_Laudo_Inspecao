import { NextResponse } from "next/server";
import { ipDaRequisicao } from "@/lib/acesso";
import { erro, lerJson } from "@/lib/api";
import { usuarioAtual } from "@/lib/sessao";
import { ErroConta, trocarSenha } from "@/lib/usuarios";

export const runtime = "nodejs";

/** Troca da própria senha: obrigatória (senha provisória) ou voluntária (pede a atual). */
export async function POST(req: Request) {
  const eu = await usuarioAtual();
  if (!eu || eu.situacao !== "APROVADO") return erro("Sessão expirada. Entre novamente.", 401);
  const corpo = await lerJson(req);
  try {
    await trocarSenha(
      eu,
      { atual: corpo.atual ? String(corpo.atual) : undefined, nova: String(corpo.nova ?? ""), confirmacao: String(corpo.confirmacao ?? "") },
      ipDaRequisicao(req),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroConta) return erro(e.message, e.status);
    console.error("Troca de senha:", e);
    return erro("Não foi possível trocar a senha agora. Tente novamente.", 500);
  }
}
