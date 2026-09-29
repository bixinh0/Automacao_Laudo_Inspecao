import "server-only";
import { randomInt } from "node:crypto";
import {
  DEPARTAMENTOS,
  departamentoValido,
  emailDoDominio,
  MENSAGEM_DOMINIO,
  normalizarEmail,
  problemaSenha,
  type Departamento,
  type Situacao,
} from "./contas";
import { motivoRecusa, type AcaoUsuario } from "./permissoes";
import { buscarPerfil, clienteSessao, clienteVerificacao, paraPerfil, type LinhaPerfil, type Perfil } from "./sessao";
import { supabase } from "./supabase";

/** Erro com mensagem para o usuário e código HTTP. */
export class ErroConta extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function dominioPermitido(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
}

// ---------------------------------------------------------------------------
// Log de auditoria
// ---------------------------------------------------------------------------

type Resumo = { id: string; nome: string; email: string } | null;
const resumo = (p: Perfil | null): Resumo => (p ? { id: p.id, nome: p.nome, email: p.email } : null);

export async function registrarAuditoria(
  acao: string,
  ator: Perfil | null,
  alvo: Perfil | null,
  extras: Record<string, unknown> = {},
) {
  const { error } = await supabase()
    .from("log_auditoria")
    .insert({ ator_id: ator?.id ?? null, acao, alvo_id: alvo?.id ?? null, detalhes: { ator: resumo(ator), alvo: resumo(alvo), ...extras } });
  if (error) console.error(`Auditoria: falha ao registrar ${acao}:`, error);
}

export interface EntradaAuditoria {
  id: string;
  acao: string;
  criadoEm: string;
  ator: Resumo;
  alvo: Resumo;
  detalhes: Record<string, unknown>;
}

export async function listarAuditoria(limite = 50): Promise<EntradaAuditoria[]> {
  const { data, error } = await supabase()
    .from("log_auditoria")
    .select("id, acao, criado_em, detalhes")
    .order("criado_em", { ascending: false })
    .limit(limite)
    .returns<{ id: string; acao: string; criado_em: string; detalhes: Record<string, unknown> | null }[]>();
  if (error) throw error;
  return data.map((l) => ({
    id: l.id,
    acao: l.acao,
    criadoEm: l.criado_em,
    ator: (l.detalhes?.ator as Resumo) ?? null,
    alvo: (l.detalhes?.alvo as Resumo) ?? null,
    detalhes: l.detalhes ?? {},
  }));
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export interface DadosCadastro {
  nome: string;
  email: string;
  departamento: string;
  senha: string;
  confirmacao: string;
}

export function validarCadastro(d: DadosCadastro): string | null {
  const dominio = dominioPermitido();
  if (!dominio) return "Cadastro indisponível: domínio permitido não configurado (ALLOWED_EMAIL_DOMAIN).";
  if (d.nome.trim().length < 3) return "Informe o nome completo (pelo menos 3 letras).";
  if (!emailDoDominio(d.email, dominio)) return MENSAGEM_DOMINIO(dominio);
  if (!departamentoValido(d.departamento)) return "Escolha um departamento da lista.";
  const senha = problemaSenha(d.senha);
  if (senha) return senha;
  if (d.senha !== d.confirmacao) return "A confirmação não é igual à senha.";
  return null;
}

/** Cria o login no Supabase Auth e o perfil PENDENTE. Não inicia sessão. */
export async function cadastrar(d: DadosCadastro): Promise<void> {
  const problema = validarCadastro(d);
  if (problema) throw new ErroConta(problema);
  const email = normalizarEmail(d.email);

  const { data, error } = await supabase().auth.admin.createUser({
    email,
    password: d.senha,
    email_confirm: true, // o controle de acesso é a aprovação manual, não a confirmação de e-mail
  });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) {
      throw new ErroConta("Não foi possível concluir o cadastro. Se você já se cadastrou, entre com sua senha ou procure um administrador.", 409);
    }
    if (error && (error.code === "weak_password" || /password/i.test(error.message))) {
      throw new ErroConta(`Senha recusada pelo servidor de autenticação: ${error.message}`);
    }
    throw error ?? new Error("Falha ao criar o login.");
  }

  const { error: erroPerfil } = await supabase()
    .from("profiles")
    .insert({ id: data.user.id, nome: d.nome.trim(), email, departamento: d.departamento, papel: "USUARIO", situacao: "PENDENTE" });
  if (erroPerfil) {
    await supabase().auth.admin.deleteUser(data.user.id);
    throw erroPerfil;
  }
}

// ---------------------------------------------------------------------------
// Limite de tentativas de login: 5 falhas em 15 min por e-mail e por IP
// ---------------------------------------------------------------------------

export const MAX_FALHAS = 5;
export const JANELA_MIN = 15;

/**
 * Por IP o padrão também é 5, como na especificação. Atenção: na rede da
 * fábrica todos os celulares costumam sair pelo mesmo IP, então 5 senhas
 * erradas de qualquer pessoa bloqueiam todos por 15 minutos. Se isso
 * atrapalhar, aumente LIMITE_FALHAS_POR_IP (ex.: 30); o limite por e-mail
 * continua 5.
 */
function maxFalhasPorIp(): number {
  return Math.max(MAX_FALHAS, Number(process.env.LIMITE_FALHAS_POR_IP) || MAX_FALHAS);
}

async function contarFalhas(
  coluna: "email" | "ip",
  valor: string,
  desde: Date,
  limite: number,
): Promise<{ n: number; maisAntiga: string | null; limite: number }> {
  // Falhas anteriores ao último acesso certo deixam de contar.
  const { data: ultimoSucesso } = await supabase()
    .from("tentativas_login")
    .select("criado_em")
    .eq(coluna, valor)
    .eq("sucesso", true)
    .gte("criado_em", desde.toISOString())
    .order("criado_em", { ascending: false })
    .limit(1)
    .returns<{ criado_em: string }[]>();
  const inicio = ultimoSucesso?.[0]?.criado_em ?? desde.toISOString();
  const { data, error } = await supabase()
    .from("tentativas_login")
    .select("criado_em")
    .eq(coluna, valor)
    .eq("sucesso", false)
    .gte("criado_em", inicio)
    .order("criado_em", { ascending: false })
    .limit(limite)
    .returns<{ criado_em: string }[]>();
  if (error) throw error;
  // A liberação conta a partir da mais antiga entre as `limite` falhas mais recentes.
  return { n: data.length, maisAntiga: data.at(-1)?.criado_em ?? null, limite };
}

/** Minutos até liberar novas tentativas, ou 0 se não está bloqueado. */
export async function minutosBloqueado(email: string, ip: string): Promise<number> {
  const desde = new Date(Date.now() - JANELA_MIN * 60_000);
  const [porEmail, porIp] = await Promise.all([
    contarFalhas("email", email, desde, MAX_FALHAS),
    contarFalhas("ip", ip, desde, maxFalhasPorIp()),
  ]);
  const bloqueios = [porEmail, porIp].filter((c) => c.n >= c.limite && c.maisAntiga);
  if (bloqueios.length === 0) return 0;
  const libera = Math.max(...bloqueios.map((c) => Date.parse(c.maisAntiga!) + JANELA_MIN * 60_000));
  return Math.max(1, Math.ceil((libera - Date.now()) / 60_000));
}

export async function registrarTentativa(email: string, ip: string, sucesso: boolean) {
  const { error } = await supabase().from("tentativas_login").insert({ email, ip, sucesso });
  if (error) console.error("Falha ao registrar tentativa de login:", error);
}

// ---------------------------------------------------------------------------
// OWNER: criação a partir das variáveis de ambiente e redefinição de emergência
// ---------------------------------------------------------------------------

/**
 * O que falta configurar para o login funcionar (só nomes, nunca valores).
 * Mostrado na tela de login enquanto houver problema: antes de existir o OWNER
 * ninguém consegue abrir o diagnóstico.
 */
export async function problemaConfiguracao(): Promise<string | null> {
  const faltando = [
    ["SUPABASE_URL", process.env.SUPABASE_URL],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["SUPABASE_PUBLISHABLE_KEY", process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY],
    ["ALLOWED_EMAIL_DOMAIN", process.env.ALLOWED_EMAIL_DOMAIN],
  ]
    .filter(([, v]) => !(v ?? "").trim())
    .map(([nome]) => nome);
  if (faltando.length) return `Configure na Vercel: ${faltando.join(", ")} (e faça Redeploy).`;
  try {
    const { data, error } = await supabase().from("profiles").select("id").eq("papel", "OWNER").limit(1);
    if (error) return "Tabela de usuários não encontrada: rode supabase/migrations/0004_autenticacao.sql no SQL Editor do Supabase.";
    if (!data.length) {
      return "O OWNER ainda não foi criado: confira OWNER_EMAIL, OWNER_NOME, OWNER_DEPARTAMENTO e OWNER_SENHA_INICIAL na Vercel.";
    }
  } catch {
    return "Não foi possível conectar ao Supabase: confira SUPABASE_URL e SUPABASE_SECRET_KEY.";
  }
  return null;
}

let ownerGarantido: Promise<void> | null = null;

/** Cria o OWNER se ainda não existir (uma vez por instância do servidor). */
export function garantirOwner(): Promise<void> {
  ownerGarantido ??= criarOuRedefinirOwner().catch((e) => {
    ownerGarantido = null;
    console.error("Não foi possível garantir o OWNER:", e);
  });
  return ownerGarantido;
}

async function idDoLogin(email: string): Promise<string | null> {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await supabase().auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => u.email?.toLowerCase() === email);
    if (achado) return achado.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function criarOuRedefinirOwner() {
  const email = normalizarEmail(process.env.OWNER_EMAIL);
  const nome = (process.env.OWNER_NOME ?? "").trim();
  const departamento = (process.env.OWNER_DEPARTAMENTO ?? "").trim().toUpperCase();
  const senhaInicial = process.env.OWNER_SENHA_INICIAL ?? "";
  if (!email || !nome || !departamentoValido(departamento) || !senhaInicial) {
    console.warn("OWNER não configurado: defina OWNER_EMAIL, OWNER_NOME, OWNER_DEPARTAMENTO e OWNER_SENHA_INICIAL.");
    return;
  }

  const { data: existente, error } = await supabase()
    .from("profiles")
    .select()
    .eq("papel", "OWNER")
    .maybeSingle<LinhaPerfil>();
  if (error) throw error;

  if (!existente) {
    let id: string | null = null;
    const criado = await supabase().auth.admin.createUser({ email, password: senhaInicial, email_confirm: true });
    if (criado.data.user) id = criado.data.user.id;
    else if (/already|exists|registered/i.test(criado.error?.message ?? "")) {
      id = await idDoLogin(email);
      if (id) await supabase().auth.admin.updateUserById(id, { password: senhaInicial });
    } else throw criado.error;
    if (!id) throw new Error("Login do OWNER não encontrado.");

    // Se o dono já tinha se cadastrado como usuário comum, esse perfil dá lugar ao do OWNER
    // (o banco não deixa ninguém ser promovido a OWNER).
    await supabase().from("profiles").delete().eq("id", id).neq("papel", "OWNER");
    // Senha inicial é provisória e sem prazo: troca obrigatória no primeiro acesso.
    const { error: erroPerfil } = await supabase()
      .from("profiles")
      .insert({ id, nome, email, departamento, papel: "OWNER", situacao: "APROVADO", senha_provisoria: true, provisoria_expira: null });
    if (erroPerfil) throw erroPerfil;
    await registrarAuditoria("CRIAR_OWNER", null, await buscarPerfil(id), { origem: "variáveis de ambiente" });
    return;
  }

  // Recuperação de emergência: OWNER_REDEFINIR_SENHA=sim + Redeploy. Aplica uma vez por implantação.
  if ((process.env.OWNER_REDEFINIR_SENHA ?? "").trim().toLowerCase() === "sim") {
    const chave = `owner_senha_redefinida:${process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local"}`;
    const { data: marca } = await supabase().from("integracao").select("chave").eq("chave", chave).maybeSingle();
    if (marca) return;
    const { error: erroSenha } = await supabase().auth.admin.updateUserById(existente.id, { password: senhaInicial });
    if (erroSenha) throw erroSenha;
    await supabase().from("profiles").update({ senha_provisoria: true, provisoria_expira: null }).eq("id", existente.id);
    await supabase().from("integracao").insert({ chave, valor: new Date().toISOString() });
    await registrarAuditoria("REDEFINIR_SENHA", null, paraPerfil(existente), { origem: "emergência (OWNER_REDEFINIR_SENHA)" });
  }
}

// ---------------------------------------------------------------------------
// Gestão de usuários
// ---------------------------------------------------------------------------

export async function listarPerfis(filtro: { situacao?: Situacao; departamento?: Departamento } = {}): Promise<Perfil[]> {
  let consulta = supabase().from("profiles").select().order("criado_em", { ascending: true });
  if (filtro.situacao) consulta = consulta.eq("situacao", filtro.situacao);
  if (filtro.departamento) consulta = consulta.eq("departamento", filtro.departamento);
  const { data, error } = await consulta.returns<LinhaPerfil[]>();
  if (error) throw error;
  return data.map(paraPerfil);
}

export async function contarPendentes(): Promise<number> {
  const { data, error } = await supabase().from("profiles").select("id").eq("situacao", "PENDENTE").limit(1000);
  if (error) return 0;
  return data.length;
}

/** Senha provisória legível: sem O/0, l/1/I; sempre com letra e número. */
export function gerarSenhaProvisoria(tamanho = 12): string {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const numeros = "23456789";
  const todos = letras + numeros;
  const chars = [letras[randomInt(letras.length)], numeros[randomInt(numeros.length)]];
  while (chars.length < tamanho) chars.push(todos[randomInt(todos.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const VALIDADE_PROVISORIA_H = 24;

export interface ResultadoAcao {
  senhaProvisoria?: string;
}

/**
 * Executa uma ação da gestão de usuários. A permissão é conferida aqui e,
 * de novo, pelo banco: as alterações de perfil usam a sessão de quem age,
 * então passam pela RLS e pelo gatilho que protege o OWNER.
 */
export async function executarAcao(
  ator: Perfil,
  alvoId: string,
  acao: AcaoUsuario,
  dados: { motivo?: string; nome?: string; departamento?: string } = {},
): Promise<ResultadoAcao> {
  const alvo = await buscarPerfil(alvoId);
  if (!alvo) throw new ErroConta("Usuário não encontrado.", 404);
  const recusa = motivoRecusa(ator, alvo, acao);
  if (recusa) throw new ErroConta(recusa, 403);

  const sessao = await clienteSessao();
  const agora = new Date().toISOString();
  const alterarComSessao = async (campos: Record<string, unknown>) => {
    const { data, error } = await sessao.from("profiles").update(campos).eq("id", alvo.id).select("id");
    if (error || !data?.length) {
      if (error) console.error(`Banco recusou ${acao}:`, error.message);
      throw new ErroConta("O banco de dados recusou esta alteração (permissão insuficiente).", 403);
    }
  };

  let resultado: ResultadoAcao = {};
  let extras: Record<string, unknown> = {};
  switch (acao) {
    case "APROVAR":
      await alterarComSessao({ situacao: "APROVADO", motivo_recusa: null, decidido_por: ator.id, decidido_em: agora });
      extras = { situacaoAnterior: alvo.situacao };
      break;
    case "RECUSAR": {
      const motivo = (dados.motivo ?? "").trim().slice(0, 500) || null;
      await alterarComSessao({ situacao: "RECUSADO", motivo_recusa: motivo, decidido_por: ator.id, decidido_em: agora });
      extras = { motivo };
      break;
    }
    case "SUSPENDER":
      await alterarComSessao({ situacao: "SUSPENSO", decidido_por: ator.id, decidido_em: agora });
      break;
    case "PROMOVER":
      await alterarComSessao({ papel: "ADMIN" });
      break;
    case "REBAIXAR":
      await alterarComSessao({ papel: "USUARIO" });
      break;
    case "EDITAR": {
      const nome = (dados.nome ?? alvo.nome).trim();
      const departamento = dados.departamento ?? alvo.departamento;
      if (nome.length < 3) throw new ErroConta("Informe o nome completo (pelo menos 3 letras).");
      if (!departamentoValido(departamento)) throw new ErroConta("Escolha um departamento da lista.");
      await alterarComSessao({ nome, departamento });
      extras = {
        antes: { nome: alvo.nome, departamento: DEPARTAMENTOS[alvo.departamento] },
        depois: { nome, departamento: DEPARTAMENTOS[departamento] },
      };
      break;
    }
    case "REDEFINIR_SENHA": {
      // Primeiro o banco autoriza (marca provisória com a sessão de quem age); só então a senha muda.
      const expira = new Date(Date.now() + VALIDADE_PROVISORIA_H * 3600_000).toISOString();
      await alterarComSessao({ senha_provisoria: true, provisoria_expira: expira });
      const senha = gerarSenhaProvisoria();
      const { error } = await supabase().auth.admin.updateUserById(alvo.id, { password: senha });
      if (error) throw error;
      resultado = { senhaProvisoria: senha };
      extras = { expiraEm: expira }; // a senha em si nunca vai para o log
      break;
    }
    case "REMOVER": {
      const { data, error } = await sessao.from("profiles").delete().eq("id", alvo.id).select("id");
      if (error || !data?.length) {
        if (error) console.error("Banco recusou REMOVER:", error.message);
        throw new ErroConta("O banco de dados recusou esta remoção (permissão insuficiente).", 403);
      }
      const { error: erroLogin } = await supabase().auth.admin.deleteUser(alvo.id);
      if (erroLogin) console.error(`Perfil ${alvo.id} removido, mas o login não:`, erroLogin);
      extras = { departamento: DEPARTAMENTOS[alvo.departamento], papel: alvo.papel };
      break;
    }
  }
  await registrarAuditoria(acao, ator, alvo, extras);
  return resultado;
}

// ---------------------------------------------------------------------------
// O próprio usuário
// ---------------------------------------------------------------------------

export async function editarProprioPerfil(eu: Perfil, nome: string, departamento: string) {
  nome = nome.trim();
  if (nome.length < 3) throw new ErroConta("Informe o nome completo (pelo menos 3 letras).");
  if (!departamentoValido(departamento)) throw new ErroConta("Escolha um departamento da lista.");
  const sessao = await clienteSessao();
  const { data, error } = await sessao.from("profiles").update({ nome, departamento }).eq("id", eu.id).select("id");
  if (error || !data?.length) throw new ErroConta("Não foi possível salvar o perfil.", 403);
  await registrarAuditoria("EDITAR", eu, eu, {
    antes: { nome: eu.nome, departamento: DEPARTAMENTOS[eu.departamento] },
    depois: { nome, departamento: DEPARTAMENTOS[departamento] },
  });
}

/**
 * Troca a própria senha. Na troca obrigatória (senha provisória) não pede a
 * senha atual — o usuário acabou de entrar com ela; na voluntária, pede.
 */
export async function trocarSenha(eu: Perfil, dados: { atual?: string; nova: string; confirmacao: string }, ip: string) {
  const problema = problemaSenha(dados.nova);
  if (problema) throw new ErroConta(problema);
  if (dados.nova !== dados.confirmacao) throw new ErroConta("A confirmação não é igual à nova senha.");

  if (eu.senhaProvisoria) {
    if (eu.provisoriaExpira && Date.parse(eu.provisoriaExpira) < Date.now()) {
      throw new ErroConta("Sua senha provisória expirou. Peça uma nova redefinição.", 403);
    }
  } else {
    if (!dados.atual) throw new ErroConta("Informe a senha atual.");
    if (await minutosBloqueado(eu.email, ip)) throw new ErroConta("Muitas tentativas. Aguarde alguns minutos.", 429);
    const { error } = await clienteVerificacao().auth.signInWithPassword({ email: eu.email, password: dados.atual });
    if (error) {
      await registrarTentativa(eu.email, ip, false);
      throw new ErroConta("Senha atual incorreta.");
    }
    if (dados.atual === dados.nova) throw new ErroConta("A nova senha precisa ser diferente da atual.");
  }

  const { error } = await supabase().auth.admin.updateUserById(eu.id, { password: dados.nova });
  if (error) {
    if (error.code === "weak_password" || /password/i.test(error.message)) {
      throw new ErroConta(`Senha recusada pelo servidor de autenticação: ${error.message}`);
    }
    throw error;
  }
  const { error: erroPerfil } = await supabase()
    .from("profiles")
    .update({ senha_provisoria: false, provisoria_expira: null })
    .eq("id", eu.id);
  if (erroPerfil) throw erroPerfil;
  await registrarAuditoria("TROCAR_SENHA", eu, eu, { obrigatoria: eu.senhaProvisoria });
}
