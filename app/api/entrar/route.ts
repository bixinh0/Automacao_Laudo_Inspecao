import { NextResponse } from "next/server";
import { COOKIE_ACESSO, DURACAO_ACESSO_S, destinoSeguro, iguais, senhaAcesso, tokenAcesso } from "@/lib/acesso";

export const runtime = "nodejs";

/** Recebe o formulário da tela /entrar (funciona mesmo sem JavaScript). */
export async function POST(req: Request) {
  const form = await req.formData();
  const destino = destinoSeguro(form.get("destino"));
  const senha = senhaAcesso();
  const voltar = (erro: string) => {
    const url = new URL("/entrar", req.url);
    url.searchParams.set("erro", erro);
    if (destino !== "/") url.searchParams.set("destino", destino);
    return NextResponse.redirect(url, 303);
  };

  if (!senha) return voltar("config");
  const digitada = String(form.get("senha") ?? "").trim();
  if (!iguais(await tokenAcesso(digitada), await tokenAcesso(senha))) {
    // Pequena espera para dificultar tentativas em série.
    await new Promise((r) => setTimeout(r, 1000));
    return voltar("senha");
  }

  const resposta = NextResponse.redirect(new URL(destino, req.url), 303);
  resposta.cookies.set(COOKIE_ACESSO, await tokenAcesso(senha), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_ACESSO_S,
  });
  return resposta;
}
