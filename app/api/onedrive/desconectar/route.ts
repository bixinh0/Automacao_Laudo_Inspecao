import { NextResponse } from "next/server";
import { desconectar } from "@/lib/integracao";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await desconectar();
  return NextResponse.redirect(new URL("/onedrive?desconectado=1", req.url), 303);
}
