import { NextResponse } from "next/server";
import { destinoSeguro, ipDaRequisicao } from "@/lib/acesso";
import { normalizarEmail } from "@/lib/contas";
import { buscarPerfil, clienteSessao, provisoriaExpirada } from "@/lib/sessao";
import { garantirOwner, minutosBloqueado, registrarTentativa } from "@/lib/usuarios";

export const runtime = "nodejs";

/**
 * Login por e-mail e senha (formulário da tela /entrar, funciona sem JavaScript).
 * O erro de credencial é sempre genérico; as mensagens de cadastro pendente,
 * recusado ou suspenso só aparecem depois de a senha ser conferida.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const email = normalizarEmail(form.get("email"));
  const senha = String(form.get("senha") ?? "");
  const destino = destinoSeguro(form.get("destino"));
  const ip = ipDaRequisicao(req);

  const voltar = (parametros: Record<string, string>) => {
    const url = new URL("/entrar", req.url);
    for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
    if (destino !== "/") url.searchParams.set("destino", destino);
    return NextResponse.redirect(url, 303);
  };
  const aviso = (situacao: string, motivo?: string | null) => {
    const url = new URL("/aguardando", req.url);
    url.searchParams.set("situacao", situacao);
    if (motivo) url.searchParams.set("motivo", motivo);
    return NextResponse.redirect(url, 303);
  };

  await garantirOwner();
  if (!email || !senha) return voltar({ erro: "credenciais", email });

  const minutos = await minutosBloqueado(email, ip);
  if (minutos) return voltar({ erro: "bloqueado", minutos: String(minutos), email });

  const sessao = await clienteSessao();
  const { data, error } = await sessao.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) {
    await registrarTentativa(email, ip, false);
    return voltar({ erro: "credenciais", email });
  }
  await registrarTentativa(email, ip, true);

  const perfil = await buscarPerfil(data.user.id);
  const sair = () => sessao.auth.signOut({ scope: "local" });
  if (!perfil) {
    await sair();
    return aviso("INCOMPLETO");
  }
  if (perfil.situacao !== "APROVADO") {
    await sair();
    return aviso(perfil.situacao, perfil.situacao === "RECUSADO" ? perfil.motivoRecusa : null);
  }
  if (provisoriaExpirada(perfil)) {
    await sair();
    return voltar({ erro: "expirada", email });
  }
  if (perfil.senhaProvisoria) return NextResponse.redirect(new URL("/trocar-senha", req.url), 303);
  return NextResponse.redirect(new URL(destino, req.url), 303);
}
