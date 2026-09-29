import { NextResponse } from "next/server";
import { clienteSessao } from "@/lib/sessao";

export async function POST(req: Request) {
  const sessao = await clienteSessao();
  await sessao.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/entrar", req.url), 303);
}
