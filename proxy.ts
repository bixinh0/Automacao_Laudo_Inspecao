import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Porta de entrada de todas as rotas (exceto login, cadastro e avisos):
 *  1. exige sessão válida (Supabase Auth) e a renova quando preciso;
 *  2. confere a situação da conta a cada requisição — suspender ou aprovar vale na hora;
 *  3. com senha provisória, só deixa chegar à troca de senha;
 *  4. rotas de gestão exigem OWNER ou ADMIN (e cada rota confere de novo no servidor).
 */

const PUBLICAS = ["/entrar", "/cadastro", "/aguardando", "/api/auth/entrar", "/api/auth/cadastro"];
const LIBERADAS_COM_PROVISORIA = ["/trocar-senha", "/api/auth/trocar-senha", "/api/auth/sair"];
const SO_GESTORES = ["/usuarios", "/api/usuarios", "/onedrive", "/api/onedrive", "/api/diagnostico"];

const OPCOES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

const casa = (caminho: string, lista: string[]) => lista.some((p) => caminho === p || caminho.startsWith(`${p}/`));

function urlSupabase() {
  const bruta = (process.env.SUPABASE_URL ?? "").trim();
  try {
    return new URL(/^https?:\/\//.test(bruta) ? bruta : `https://${bruta}`).origin;
  } catch {
    return bruta;
  }
}

type PerfilProxy = { papel: string; situacao: string; senha_provisoria: boolean; provisoria_expira: string | null; motivo_recusa: string | null };

async function perfil(id: string): Promise<PerfilProxy | null> {
  const chave = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const r = await fetch(
    `${urlSupabase()}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=papel,situacao,senha_provisoria,provisoria_expira,motivo_recusa`,
    { headers: { apikey: chave, Authorization: `Bearer ${chave}` }, cache: "no-store" },
  );
  if (!r.ok) throw new Error(`profiles HTTP ${r.status}`);
  const linhas = (await r.json()) as PerfilProxy[];
  return linhas[0] ?? null;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (casa(pathname, PUBLICAS)) return NextResponse.next();
  const api = pathname.startsWith("/api/");

  // Cookies que o Supabase renovar/limpar vão em qualquer resposta que sair daqui.
  const cookiesNovos: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const sessao = createServerClient(
    urlSupabase(),
    (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim(),
    {
      cookieOptions: OPCOES_COOKIE,
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (lista) => {
          for (const c of lista) {
            req.cookies.set(c.name, c.value);
            cookiesNovos.push({ ...c, options: { ...c.options, ...OPCOES_COOKIE } });
          }
        },
      },
    },
  );
  const responder = (r: NextResponse) => {
    for (const c of cookiesNovos) r.cookies.set(c.name, c.value, c.options);
    r.headers.set("Cache-Control", "private, no-store");
    return r;
  };
  const negar = (status: number, erro: string, destino: string) =>
    responder(api ? NextResponse.json({ erro }, { status }) : NextResponse.redirect(new URL(destino, req.url)));

  const { data } = await sessao.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) {
    const entrar = new URL("/entrar", req.url);
    if (pathname !== "/") entrar.searchParams.set("destino", pathname + search);
    return negar(401, "Sessão expirada. Entre novamente.", entrar.pathname + entrar.search);
  }

  let p: PerfilProxy | null;
  try {
    p = await perfil(uid);
  } catch (e) {
    console.error("Proxy: falha ao ler o perfil:", e);
    return negar(503, "Serviço indisponível. Tente novamente.", "/entrar?erro=indisponivel");
  }

  if (!p || p.situacao !== "APROVADO") {
    await sessao.auth.signOut({ scope: "local" });
    const aviso = new URL("/aguardando", req.url);
    aviso.searchParams.set("situacao", p?.situacao ?? "INCOMPLETO");
    if (p?.situacao === "RECUSADO" && p.motivo_recusa) aviso.searchParams.set("motivo", p.motivo_recusa);
    return negar(403, "Acesso não liberado.", aviso.pathname + aviso.search);
  }

  if (p.senha_provisoria) {
    if (p.provisoria_expira && Date.parse(p.provisoria_expira) < Date.now()) {
      await sessao.auth.signOut({ scope: "local" });
      return negar(403, "Senha provisória expirada.", "/entrar?erro=expirada");
    }
    if (!casa(pathname, LIBERADAS_COM_PROVISORIA)) {
      return negar(403, "Defina uma nova senha antes de continuar.", "/trocar-senha");
    }
  }

  if (casa(pathname, SO_GESTORES) && p.papel !== "OWNER" && p.papel !== "ADMIN") {
    return negar(403, "Apenas OWNER e ADMIN têm acesso a esta área.", "/");
  }

  return responder(NextResponse.next({ request: req }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
