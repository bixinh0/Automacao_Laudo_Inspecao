import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { configOneDrive, COOKIE_ESTADO, urlAutorizacao } from "@/lib/onedrive";

export const runtime = "nodejs";

/** Leva à tela de login da Microsoft para autorizar o envio dos laudos. */
export async function GET(req: Request) {
  const cfg = configOneDrive();
  if (!cfg) return NextResponse.redirect(new URL("/onedrive?erro=config", req.url), 303);
  const estado = randomBytes(24).toString("hex");
  const resposta = NextResponse.redirect(urlAutorizacao(cfg, new URL("/api/onedrive/retorno", req.url).toString(), estado), 303);
  resposta.cookies.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/onedrive",
    maxAge: 10 * 60,
  });
  return resposta;
}
