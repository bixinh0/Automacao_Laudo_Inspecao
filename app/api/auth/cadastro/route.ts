import { NextResponse } from "next/server";
import { erro, lerJson } from "@/lib/api";
import { cadastrar, ErroConta } from "@/lib/usuarios";

export const runtime = "nodejs";

/** Cadastro: cria a conta como PENDENTE. Não inicia sessão nem envia e-mail. */
export async function POST(req: Request) {
  const corpo = await lerJson(req);
  try {
    await cadastrar({
      nome: String(corpo.nome ?? ""),
      email: String(corpo.email ?? ""),
      departamento: String(corpo.departamento ?? ""),
      senha: String(corpo.senha ?? ""),
      confirmacao: String(corpo.confirmacao ?? ""),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConta) return erro(e.message, e.status);
    console.error("Cadastro:", e);
    return erro("Não foi possível concluir o cadastro agora. Tente novamente em instantes.", 500);
  }
}
