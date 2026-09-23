import { NextResponse, type NextRequest } from "next/server";
import { acessoValido, COOKIE_ACESSO } from "@/lib/acesso";

/** Exige a senha de acesso em todas as páginas e APIs, exceto a tela de entrada. */
export async function proxy(req: NextRequest) {
  if (await acessoValido(req.cookies.get(COOKIE_ACESSO)?.value)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erro: "Acesso expirado. Recarregue a página e digite a senha." }, { status: 401 });
  }
  const entrar = new URL("/entrar", req.url);
  if (pathname !== "/") entrar.searchParams.set("destino", pathname + search);
  return NextResponse.redirect(entrar);
}

export const config = {
  matcher: ["/((?!entrar|api/entrar|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
