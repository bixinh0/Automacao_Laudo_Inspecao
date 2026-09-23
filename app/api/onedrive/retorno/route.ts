import { NextResponse, type NextRequest } from "next/server";
import { iguais } from "@/lib/acesso";
import { salvarConexao } from "@/lib/integracao";
import { configOneDrive, COOKIE_ESTADO, trocarCodigo } from "@/lib/onedrive";

export const runtime = "nodejs";

/** A Microsoft devolve o usuário para cá depois do login, com o código de autorização. */
export async function GET(req: NextRequest) {
  const voltar = (parametro: string) => {
    const resposta = NextResponse.redirect(new URL(`/onedrive?${parametro}`, req.url), 303);
    resposta.cookies.delete({ name: COOKIE_ESTADO, path: "/api/onedrive" });
    return resposta;
  };
  const cfg = configOneDrive();
  if (!cfg) return voltar("erro=config");

  const url = req.nextUrl;
  const erroMicrosoft = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (erroMicrosoft) return voltar(`erro=${encodeURIComponent(erroMicrosoft.split("\r\n")[0].slice(0, 300))}`);

  const estado = url.searchParams.get("state") ?? "";
  const esperado = req.cookies.get(COOKIE_ESTADO)?.value ?? "";
  const codigo = url.searchParams.get("code");
  if (!codigo || !esperado || !iguais(estado, esperado)) return voltar("erro=estado");

  try {
    const tokens = await trocarCodigo(cfg, codigo, new URL("/api/onedrive/retorno", req.url).toString());
    await salvarConexao(tokens);
    return voltar("ok=1");
  } catch (e) {
    console.error("OneDrive: falha ao conectar:", e);
    return voltar(`erro=${encodeURIComponent(((e as Error).message ?? "falha").slice(0, 300))}`);
  }
}
