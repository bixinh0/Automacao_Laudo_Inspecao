import { gestorLiberado } from "@/lib/sessao";
import { NextResponse } from "next/server";
import { desconectar } from "@/lib/integracao";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await gestorLiberado())) return NextResponse.json({ erro: "Apenas OWNER e ADMIN." }, { status: 403 });
  await desconectar();
  return NextResponse.redirect(new URL("/onedrive?desconectado=1", req.url), 303);
}
