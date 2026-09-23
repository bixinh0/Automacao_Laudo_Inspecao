import "server-only";
import { NextResponse } from "next/server";
import { ErroLaudo } from "./laudos";

export function erro(mensagem: string, status = 400) {
  return NextResponse.json({ erro: mensagem }, { status });
}

/** Converte exceções em resposta JSON; detalhes internos só vão para o log. */
export function tratarErro(e: unknown) {
  if (e instanceof ErroLaudo) return erro(e.message, e.status);
  console.error(e);
  return erro("Erro inesperado no servidor. Tente novamente em instantes.", 500);
}

export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const corpo = await req.json();
    return corpo && typeof corpo === "object" ? corpo : {};
  } catch {
    return {};
  }
}
