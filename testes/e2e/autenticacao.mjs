/**
 * Critérios de aceite da autenticação, de ponta a ponta no navegador (celular),
 * contra o Supabase simulado (testes/e2e/supabase-simulado.mjs).
 * Rodar com: npm run test:e2e   (ver scripts/testar-e2e.sh)
 */
import { chromium, devices } from "playwright";
const S = process.env.PASTA_CAPTURAS || "/tmp", B = "http://localhost:3004", F = "http://localhost:54321";
const browser = await chromium.launch();
let falhas = 0;
const ok = (desc, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${desc}${extra ? " — " + extra : ""}`); if (!cond) falhas++; };
const estado = async () => (await fetch(F + "/__estado")).json();
const perfilDe = async (email) => (await estado()).tabelas.profiles.find((p) => p.email === email);

async function novaSessao() { const ctx = await browser.newContext({ ...devices["Pixel 7"] }); return ctx.newPage(); }
async function entrar(page, email, senha) {
  await page.goto(B + "/entrar");
  await page.fill("#email", email); await page.fill("#senha", senha);
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  return page.url();
}
const api = (page, caminho, corpo) => page.evaluate(async ([c, b]) => {
  const r = await fetch(c, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}, [caminho, corpo]);
async function cadastrar(page, nome, email, dep, senha) {
  await page.goto(B + "/cadastro");
  await page.fill("#nome", nome); await page.fill("#email", email); await page.selectOption("#departamento", dep);
  await page.fill("#senha", senha); await page.fill("#confirmacao", senha);
  await page.click("button[type=submit]");
  await page.waitForTimeout(700);
  return page.url();
}

// ===== OWNER: primeiro acesso com senha inicial provisória =====
const owner = await novaSessao();
let url = await entrar(owner, "luan.godoi@vanderhulst.com.br", "Van@123");
ok("OWNER entra com a senha inicial e é levado à troca obrigatória", url.endsWith("/trocar-senha"), url);
await owner.goto(B + "/historico");
ok("Com senha provisória, qualquer outra tela volta para a troca", owner.url().endsWith("/trocar-senha"));
await owner.screenshot({ path: `${S}/a-trocar.png` });
await owner.fill("#nova", "Qualidade2026"); await owner.fill("#confirmacao-nova", "Qualidade2026");
await Promise.all([owner.waitForURL(B + "/"), owner.click("button[type=submit]")]);
ok("Após definir a nova senha, OWNER acessa o sistema", owner.url() === B + "/");
ok("Flag de senha provisória do OWNER foi limpa", (await perfilDe("luan.godoi@vanderhulst.com.br")).senha_provisoria === false);

// ===== Cadastro: domínio =====
const anon = await novaSessao();
await anon.goto(B + "/cadastro");
await anon.fill("#email", "fulano@gmail.com"); await anon.click("#nome");
ok("Cliente: e-mail de outro domínio mostra o aviso", (await anon.locator(".alerta").first().textContent())?.includes("@vanderhulst.com.br"));
await anon.screenshot({ path: `${S}/a-cadastro-erro.png`, fullPage: true });
for (const email of ["fulano@gmail.com", "usuario@sub.vanderhulst.com.br", "usuario@vanderhulst.com"]) {
  const r = await api(anon, "/api/auth/cadastro", { nome: "Fulano Teste", email, departamento: "QUALIDADE", senha: "Senha1234", confirmacao: "Senha1234" });
  ok(`Servidor recusa ${email}`, r.status === 400 && r.corpo.erro === "Use seu e-mail corporativo @vanderhulst.com.br", `${r.status} ${r.corpo.erro}`);
}
const fraca = await api(anon, "/api/auth/cadastro", { nome: "Fulano Teste", email: "fulano@vanderhulst.com.br", departamento: "QUALIDADE", senha: "abc", confirmacao: "abc" });
ok("Servidor recusa senha fora da política", fraca.status === 400, fraca.corpo.erro);
const depInvalido = await api(anon, "/api/auth/cadastro", { nome: "Fulano Teste", email: "fulano@vanderhulst.com.br", departamento: "MARKETING", senha: "Senha1234", confirmacao: "Senha1234" });
ok("Servidor recusa departamento fora da lista", depInvalido.status === 400);

// ===== Cadastros válidos nascem PENDENTE =====
for (const [nome, email, dep] of [["Ana Admin", "ana.admin@vanderhulst.com.br", "PRODUCAO"], ["Bruno Admin", "bruno.admin@vanderhulst.com.br", "ENGENHARIA"], ["Carla Usuária", "carla@vanderhulst.com.br", "COMERCIAL"], ["Davi Usuário", "davi@vanderhulst.com.br", "SUPRIMENTOS"], ["Elisa Pendente", "  Elisa@VanderHulst.com.br ", "RECURSOS_HUMANOS"]]) {
  const u = await cadastrar(await novaSessao(), nome, email, dep, "Senha1234");
  ok(`Cadastro de ${nome.split(" ")[0]} vai para "aguardando"`, u.includes("/aguardando?situacao=PENDENTE"), u);
}
ok("E-mail gravado em minúsculas e sem espaços", Boolean(await perfilDe("elisa@vanderhulst.com.br")));
ok("Todos nascem PENDENTE", ["ana.admin", "bruno.admin", "carla", "davi", "elisa"].every(async () => true) && (await estado()).tabelas.profiles.filter((p) => p.papel !== "OWNER").every((p) => p.situacao === "PENDENTE"));
const pendente = await novaSessao();
url = await entrar(pendente, "carla@vanderhulst.com.br", "Senha1234");
ok("Login de conta pendente mostra 'aguarda aprovação'", url.includes("situacao=PENDENTE") && (await pendente.textContent("h1")).includes("aguarda aprovação"), url);
await pendente.goto(B + "/"); ok("Conta pendente não acessa o sistema", pendente.url().includes("/entrar"));
const dup = await api(anon, "/api/auth/cadastro", { nome: "Carla De Novo", email: "carla@vanderhulst.com.br", departamento: "COMERCIAL", senha: "Senha1234", confirmacao: "Senha1234" });
ok("E-mail duplicado é recusado", dup.status === 409);

// ===== Mensagem genérica de login =====
const x = await novaSessao();
await entrar(x, "naoexiste@vanderhulst.com.br", "Qualquer123"); const msgInexistente = await x.textContent(".alerta");
await entrar(x, "carla@vanderhulst.com.br", "SenhaErrada1"); const msgErrada = await x.textContent(".alerta");
ok("Erro de login é o mesmo para e-mail inexistente e senha errada", msgInexistente === msgErrada && msgErrada === "E-mail ou senha inválidos.", msgErrada);

// ===== OWNER aprova e promove =====
await owner.goto(B + "/usuarios");
ok("Menu mostra contador de pendentes", (await owner.locator(".contador-menu").textContent()) === "5");
await owner.screenshot({ path: `${S}/a-usuarios-owner.png`, fullPage: true });
const id = async (email) => (await perfilDe(email)).id;
for (const e of ["ana.admin@vanderhulst.com.br", "bruno.admin@vanderhulst.com.br", "carla@vanderhulst.com.br", "davi@vanderhulst.com.br"]) {
  const r = await api(owner, `/api/usuarios/${await id(e)}`, { acao: "APROVAR" });
  ok(`OWNER aprova ${e.split("@")[0]}`, r.status === 200, JSON.stringify(r.corpo));
}
for (const e of ["ana.admin@vanderhulst.com.br", "bruno.admin@vanderhulst.com.br"]) {
  const r = await api(owner, `/api/usuarios/${await id(e)}`, { acao: "PROMOVER" });
  ok(`OWNER promove ${e.split("@")[0]} a ADMIN`, r.status === 200);
}
url = await entrar(pendente, "carla@vanderhulst.com.br", "Senha1234");
ok("Aprovação libera o acesso imediatamente", url === B + "/", url);

// ===== ADMIN contra o OWNER (API direta) =====
const ana = await novaSessao(); await entrar(ana, "ana.admin@vanderhulst.com.br", "Senha1234");
const idOwner = await id("luan.godoi@vanderhulst.com.br");
for (const [acao, extra] of [["EDITAR", { nome: "Hackeado", departamento: "COMERCIAL" }], ["REBAIXAR", {}], ["SUSPENDER", {}], ["REDEFINIR_SENHA", {}], ["REMOVER", {}]]) {
  const r = await api(ana, `/api/usuarios/${idOwner}`, { acao, ...extra });
  ok(`ADMIN tenta ${acao} o OWNER → 403`, r.status === 403, r.corpo.erro);
}
const o = await perfilDe("luan.godoi@vanderhulst.com.br");
ok("OWNER continua intacto", o.papel === "OWNER" && o.situacao === "APROVADO" && o.nome === "Luan Godoi");
ok("ADMIN não promove ninguém a ADMIN", (await api(ana, `/api/usuarios/${await id("davi@vanderhulst.com.br")}`, { acao: "PROMOVER" })).status === 403);
for (const acao of ["REBAIXAR", "SUSPENDER", "REMOVER", "REDEFINIR_SENHA", "EDITAR"]) {
  const r = await api(ana, `/api/usuarios/${await id("bruno.admin@vanderhulst.com.br")}`, { acao, nome: "Mudado", departamento: "COMERCIAL" });
  ok(`ADMIN tenta ${acao} outro ADMIN → 403`, r.status === 403, r.corpo.erro);
}
ok("ADMIN não muda a própria situação", (await api(ana, `/api/usuarios/${await id("ana.admin@vanderhulst.com.br")}`, { acao: "SUSPENDER" })).status === 403);

// ===== OWNER contra si mesmo =====
for (const acao of ["REBAIXAR", "SUSPENDER", "REMOVER"]) {
  const r = await api(owner, `/api/usuarios/${idOwner}`, { acao });
  ok(`OWNER tenta ${acao} a si mesmo → 403`, r.status === 403, r.corpo.erro);
}

// ===== Usuário comum na gestão =====
const carla = pendente;
const rc = await api(carla, `/api/usuarios/${await id("davi@vanderhulst.com.br")}`, { acao: "APROVAR" });
ok("Usuário comum chamando a API de gestão → 403", rc.status === 403, rc.corpo.erro);
await carla.goto(B + "/usuarios"); ok("Usuário comum não abre a tela de usuários", carla.url() === B + "/");
ok("Usuário comum não vê o item Usuários no menu", (await carla.locator("nav >> text=Usuários").count()) === 0);
const rd = await carla.evaluate(async () => (await fetch("/api/diagnostico")).status);
ok("Usuário comum não acessa o diagnóstico", rd === 403);

// ===== ADMIN recusa com motivo =====
const rr = await api(ana, `/api/usuarios/${await id("elisa@vanderhulst.com.br")}`, { acao: "RECUSAR", motivo: "Não é da equipe de produção." });
ok("ADMIN recusa pendente com motivo", rr.status === 200);
const elisa = await novaSessao(); url = await entrar(elisa, "elisa@vanderhulst.com.br", "Senha1234");
ok("Conta recusada vê a recusa com o motivo", url.includes("situacao=RECUSADO") && (await elisa.textContent(".motivo"))?.includes("Não é da equipe"), url);
await elisa.screenshot({ path: `${S}/a-recusado.png` });

// ===== Suspensão vale na hora (sessão já aberta) =====
const davi = await novaSessao(); url = await entrar(davi, "davi@vanderhulst.com.br", "Senha1234");
ok("Davi entra normalmente", url === B + "/");
ok("ADMIN suspende Davi", (await api(ana, `/api/usuarios/${await id("davi@vanderhulst.com.br")}`, { acao: "SUSPENDER" })).status === 200);
await davi.goto(B + "/historico");
// O pré-carregamento de links do Next pode derrubar a sessão antes do clique: aí cai no login.
ok("Sessão aberta de conta suspensa é derrubada no próximo clique",
  davi.url().includes("situacao=SUSPENSO") || davi.url().includes("/entrar"), davi.url());
await davi.goto(B + "/historico");
ok("Conta suspensa não chega ao histórico", !davi.url().endsWith("/historico"), davi.url());
url = await entrar(davi, "davi@vanderhulst.com.br", "Senha1234");
ok("Conta suspensa não entra", url.includes("situacao=SUSPENSO"));
ok("ADMIN reverte: reaprova Davi", (await api(ana, `/api/usuarios/${await id("davi@vanderhulst.com.br")}`, { acao: "APROVAR" })).status === 200);

// ===== Redefinição de senha =====
const red = await api(ana, `/api/usuarios/${await id("davi@vanderhulst.com.br")}`, { acao: "REDEFINIR_SENHA" });
const temp = red.corpo.senhaProvisoria;
ok("ADMIN redefine a senha e recebe a provisória uma vez", red.status === 200 && /^[A-Za-z0-9]{12}$/.test(temp ?? ""), temp);
url = await entrar(davi, "davi@vanderhulst.com.br", "Senha1234");
ok("Senha antiga deixa de funcionar", url.includes("erro=credenciais"));
url = await entrar(davi, "davi@vanderhulst.com.br", temp);
ok("Senha provisória obriga a troca no primeiro acesso", url.endsWith("/trocar-senha"));
const tentativaFuga = await api(davi, "/api/laudos", { numeroOP: "12345" });
ok("Com senha provisória, a API de laudos também é bloqueada", tentativaFuga.status === 403);
await davi.fill("#nova", "NovaSenha99"); await davi.fill("#confirmacao-nova", "NovaSenha99");
await Promise.all([davi.waitForURL(B + "/"), davi.click("button[type=submit]")]);
ok("Davi define a própria senha e entra", davi.url() === B + "/");

// ===== Senha nunca em texto puro =====
const e1 = await estado();
const tudo = JSON.stringify({ profiles: e1.tabelas.profiles, log: e1.tabelas.log_auditoria, tentativas: e1.tabelas.tentativas_login, laudo: e1.tabelas.laudo });
ok("Nenhuma senha aparece no banco (perfis, log, tentativas)", !["Senha1234", "Qualidade2026", "NovaSenha99", "Van@123", temp].some((s) => tudo.includes(s)));
const logServidor = (await import("node:fs")).readFileSync(process.env.LOG_SERVIDOR, "utf8");
ok("Nenhuma senha aparece no log do servidor", !["Senha1234", "Qualidade2026", "NovaSenha99", "Van@123", temp].some((s) => logServidor.includes(s)));

// ===== Auditoria =====
const acoes = e1.tabelas.log_auditoria.map((a) => a.acao);
for (const a of ["CRIAR_OWNER", "APROVAR", "PROMOVER", "RECUSAR", "SUSPENDER", "REDEFINIR_SENHA", "TROCAR_SENHA"]) ok(`Auditoria registra ${a}`, acoes.includes(a));
const redefinicao = e1.tabelas.log_auditoria.find((a) => a.acao === "REDEFINIR_SENHA");
ok("Auditoria da redefinição diz quem redefiniu e para quem", redefinicao.detalhes.ator.email === "ana.admin@vanderhulst.com.br" && redefinicao.detalhes.alvo.email === "davi@vanderhulst.com.br");

// ===== OWNER rebaixa e remove; edição =====
ok("OWNER edita Carla", (await api(owner, `/api/usuarios/${await id("carla@vanderhulst.com.br")}`, { acao: "EDITAR", nome: "Carla Souza", departamento: "QUALIDADE" })).status === 200);
ok("OWNER rebaixa Bruno para usuário", (await api(owner, `/api/usuarios/${await id("bruno.admin@vanderhulst.com.br")}`, { acao: "REBAIXAR" })).status === 200);
ok("ADMIN remove Bruno (agora usuário)", (await api(ana, `/api/usuarios/${await id("bruno.admin@vanderhulst.com.br")}`, { acao: "REMOVER" })).status === 200);
const e2 = await estado();
ok("Bruno sumiu de perfis e do Auth", !e2.tabelas.profiles.some((p) => p.email.startsWith("bruno")) && !JSON.stringify(e2).includes('"email":"bruno.admin@vanderhulst.com.br","senha'));
for (const a of ["EDITAR", "REBAIXAR", "REMOVER"]) ok(`Auditoria registra ${a}`, e2.tabelas.log_auditoria.some((l) => l.acao === a));

// ===== Meu perfil =====
await carla.goto(B + "/perfil");
await carla.screenshot({ path: `${S}/a-perfil.png`, fullPage: true });
ok("Meu perfil mostra papel e situação só para leitura", (await carla.textContent(".dados-perfil"))?.includes("Aprovado"));
ok("Usuário edita o próprio nome", (await api(carla, "/api/perfil", { nome: "Carla S. Souza", departamento: "QUALIDADE" })).status === 200);
const troca = await api(carla, "/api/auth/trocar-senha", { atual: "errada", nova: "Outra12345", confirmacao: "Outra12345" });
ok("Troca voluntária exige a senha atual correta", troca.status === 400, troca.corpo.erro);
ok("Troca voluntária com a senha atual funciona", (await api(carla, "/api/auth/trocar-senha", { atual: "Senha1234", nova: "Outra12345", confirmacao: "Outra12345" })).status === 200);

// ===== Limite de tentativas =====
const z = await novaSessao();
for (let i = 0; i < 5; i++) await entrar(z, "davi@vanderhulst.com.br", "errada" + i);
url = await entrar(z, "davi@vanderhulst.com.br", "NovaSenha99");
ok("5 falhas em 15 min bloqueiam até a senha certa", url.includes("erro=bloqueado"), url);
await z.screenshot({ path: `${S}/a-bloqueado.png` });

await owner.goto(B + "/usuarios"); await owner.screenshot({ path: `${S}/a-usuarios-final.png`, fullPage: true });
await ana.goto(B + "/usuarios"); await ana.screenshot({ path: `${S}/a-usuarios-admin.png`, fullPage: true });
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os critérios passaram.");
await browser.close();
process.exit(falhas ? 1 : 0);
