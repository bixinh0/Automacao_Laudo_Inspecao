import { NextResponse } from "next/server";
import { COOKIE_ACESSO } from "@/lib/acesso";

export async function POST(req: Request) {
  const resposta = NextResponse.redirect(new URL("/entrar", req.url), 303);
  resposta.cookies.delete(COOKIE_ACESSO);
  return resposta;
}
