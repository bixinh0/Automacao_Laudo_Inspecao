import { NextResponse } from "next/server";
import { erro, lerJson } from "@/lib/api";
import { usuarioLiberado } from "@/lib/sessao";
import { editarProprioPerfil, ErroConta } from "@/lib/usuarios";

export const runtime = "nodejs";

/** O próprio usuário edita nome e departamento (papel e situação não). */
export async function POST(req: Request) {
  const eu = await usuarioLiberado();
  if (!eu) return erro("Sessão expirada. Entre novamente.", 401);
  const corpo = await lerJson(req);
  try {
    await editarProprioPerfil(eu, String(corpo.nome ?? ""), String(corpo.departamento ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroConta) return erro(e.message, e.status);
    console.error("Perfil:", e);
    return erro("Não foi possível salvar agora. Tente novamente.", 500);
  }
}
