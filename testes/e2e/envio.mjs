/**
 * Tela de envio, de ponta a ponta no navegador (celular), contra o Supabase simulado:
 * rascunho criado com a OP, cada foto enviada logo após a escolha com progresso e
 * miniatura do servidor, remoção antes de emitir, restauração ao recarregar
 * (sessionStorage), layout em duas colunas deitado e emissão do PDF.
 * Rodar com: npm run test:e2e   (ver scripts/testar-e2e.sh)
 */
import { randomBytes } from "node:crypto";
import { chromium, devices } from "playwright";
import sharp from "sharp";

const S = process.env.PASTA_CAPTURAS || "/tmp", B = "http://localhost:3004", F = "http://localhost:54321";
const browser = await chromium.launch();
let falhas = 0;
const ok = (desc, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${desc}${extra ? " — " + extra : ""}`); if (!cond) falhas++; };
const estado = async () => (await fetch(F + "/__estado")).json();
const esperar = async (desc, cond, ms = 15000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
  console.log(`  (tempo esgotado esperando: ${desc})`);
  return false;
};

// Duas contas aprovadas, criadas direto no Supabase simulado.
async function criarConta(nome, email, senha) {
  const u = await (await fetch(F + "/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: senha }) })).json();
  await fetch(F + "/rest/v1/profiles", {
    method: "POST",
    body: JSON.stringify({ id: u.id, nome, email, departamento: "QUALIDADE", papel: "USUARIO", situacao: "APROVADO", senha_provisoria: false }),
  });
  return u.id;
}
const idRita = await criarConta("Rita Inspetora", "rita@vanderhulst.com.br", "Inspecao2026");
await criarConta("Otávio Outro", "otavio@vanderhulst.com.br", "Outro2026x");

async function sessao(email, senha, dispositivo = devices["Pixel 7"]) {
  const ctx = await browser.newContext({ ...dispositivo });
  const page = await ctx.newPage();
  await page.goto(B + "/entrar");
  await page.fill("#email", email); await page.fill("#senha", senha);
  await Promise.all([page.waitForURL(B + "/"), page.click("button[type=submit]")]);
  return page;
}
const api = (page, metodo, caminho, corpo) => page.evaluate(async ([m, c, b]) => {
  const r = await fetch(c, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}, [metodo, caminho, corpo]);

/** JPEG com ruído (não comprime): grande o bastante para ver o progresso do envio. */
async function foto(nome, largura = 1600, altura = 1200) {
  const buffer = await sharp(randomBytes(largura * altura * 3), { raw: { width: largura, height: altura, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  return { name: nome, mimeType: "image/jpeg", buffer };
}
const entradaFormulario = "input[data-tipo=FORMULARIO]", entradaPecas = "input[data-tipo=PECA]";
const blocoFormulario = ".bloco-formulario", blocoPecas = ".bloco-pecas";
const estados = (page, bloco) => page.$$eval(`${bloco} .foto`, (l) => l.map((x) => x.dataset.estado));
const rascunhos = async () => (await estado()).tabelas.laudo.filter((l) => l.criado_por === idRita);
const imagensDe = async (id) => (await estado()).tabelas.imagem.filter((i) => i.laudo_id === id);
const arquivosDe = async (id) => (await estado()).arquivos.map((a) => a.k).filter((k) => k.startsWith(`laudos/${id}/`));

const rita = await sessao("rita@vanderhulst.com.br", "Inspecao2026");
const cdp = await rita.context().newCDPSession(rita);
const limitarEnvio = (bytesPorSegundo) => cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: bytesPorSegundo });

// ===== Foto escolhida antes da OP: espera, sem criar nada no banco =====
await rita.setInputFiles(entradaPecas, [await foto("peca-1.jpg")]);
await rita.waitForTimeout(1200);
ok("Sem OP, a foto espera com o aviso 'Aguardando OP'", (await estados(rita, blocoPecas))[0] === "aguardando" && (await rita.textContent(`${blocoPecas} .estado-foto`)).includes("Aguardando OP"));
ok("Sem OP, nenhum rascunho é criado", (await rascunhos()).length === 0);

// ===== OP informada: rascunho no banco e a foto que esperava sobe sozinha =====
await rita.fill("#op", "4321");
ok("Rascunho criado assim que a OP é informada", await esperar("rascunho", async () => (await rascunhos()).length === 1));
const [rascunho] = await rascunhos();
ok("Rascunho com status RASCUNHO, OP e autora", rascunho.status === "RASCUNHO" && rascunho.numero_op === "4321" && rascunho.criado_por_nome === "Rita Inspetora" && rascunho.caminho_pdf === null);
ok("A foto que esperava a OP sobe sem ação da pessoa", await esperar("peça pronta", async () => (await estados(rita, blocoPecas))[0] === "pronta"));
const srcPeca = await rita.getAttribute(`${blocoPecas} .foto img`, "src");
ok("Miniatura exibida é a devolvida pelo servidor (JPEG em data URL)", srcPeca?.startsWith("data:image/jpeg;base64,"), srcPeca?.slice(0, 30));
const miniatura = await sharp(Buffer.from(srcPeca.split(",")[1], "base64")).metadata();
ok("Miniatura é pequena (maior lado de 320 px)", Math.max(miniatura.width, miniatura.height) === 320, `${miniatura.width}x${miniatura.height}`);
let imgs = await imagensDe(rascunho.id);
ok("Foto vinculada ao rascunho no banco, com hash e dimensões", imgs.length === 1 && imgs[0].tipo === "PECA" && imgs[0].ordem === 1 && /^[0-9a-f]{64}$/.test(imgs[0].hash_sha256) && imgs[0].largura === 1280 && imgs[0].recebida_em);
let arquivos = await arquivosDe(rascunho.id);
ok("No Storage ficam a foto processada e a miniatura; o original sai", arquivos.includes(`laudos/${rascunho.id}/fotos/${imgs[0].id}.jpg`) && arquivos.includes(`laudos/${rascunho.id}/miniaturas/${imgs[0].id}.jpg`) && !arquivos.some((k) => k.includes("/brutos/")), arquivos.join(" "));

// ===== Progresso por arquivo, com a rede lenta =====
await limitarEnvio(400 * 1024);
await rita.setInputFiles(entradaFormulario, [await foto("formulario-frente.jpg"), await foto("formulario-verso.jpg")]);
const vistos = new Set();
let parcial = null;
await esperar("formulário enviado", async () => {
  const lista = await rita.$$eval(`${blocoFormulario} .foto`, (l) => l.map((x) => ({ e: x.dataset.estado, p: Number(x.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow") ?? -1), t: x.querySelector(".estado-foto")?.textContent ?? "" })));
  for (const f of lista) {
    vistos.add(f.e);
    if (f.e === "enviando" && f.p > 5 && f.p < 90 && !parcial) { parcial = f; await rita.screenshot({ path: `${S}/e-progresso.png` }); }
  }
  return lista.length === 2 && lista.every((f) => f.e === "pronta");
}, 60000);
await limitarEnvio(-1);
ok("Cada foto mostra a própria barra e a porcentagem durante o envio", Boolean(parcial) && /Enviando \d+%/.test(parcial.t), JSON.stringify(parcial));
ok("A foto passa por enviando → processando → pronta", ["enviando", "processando", "pronta"].every((e) => vistos.has(e)), [...vistos].join(","));
imgs = await imagensDe(rascunho.id);
ok("Folhas do formulário na ordem em que foram escolhidas", imgs.filter((i) => i.tipo === "FORMULARIO").map((i) => i.ordem).sort().join() === "1,2");

// ===== Remover foto já enviada =====
const idVerso = imgs.find((i) => i.tipo === "FORMULARIO" && i.ordem === 2).id;
await rita.click(`${blocoFormulario} .foto:nth-child(2) .remover`);
ok("Foto removida some da tela", await esperar("remoção", async () => (await estados(rita, blocoFormulario)).length === 1));
ok("Foto removida sai do banco", await esperar("remoção no banco", async () => !(await imagensDe(rascunho.id)).some((i) => i.id === idVerso)));
ok("Arquivos da foto removida saem do Storage", !(await arquivosDe(rascunho.id)).some((k) => k.includes(idVerso)));

// ===== Remover durante o envio: cancela e não deixa nada para trás =====
await limitarEnvio(60 * 1024);
await rita.setInputFiles(entradaPecas, [await foto("peca-cancelada.jpg")]);
ok("Envio lento começa", await esperar("enviando", async () => (await estados(rita, blocoPecas))[1] === "enviando"));
await rita.click(`${blocoPecas} .foto:nth-child(2) .remover`);
await limitarEnvio(-1);
ok("Foto cancelada some da tela", await esperar("cancelada", async () => (await estados(rita, blocoPecas)).length === 1));
await rita.waitForTimeout(1500);
imgs = await imagensDe(rascunho.id);
ok("Foto cancelada não fica no banco", imgs.length === 2 && imgs.filter((i) => i.tipo === "PECA").length === 1, imgs.map((i) => `${i.tipo}${i.ordem}`).join());
ok("Nenhum arquivo órfão da foto cancelada", (await arquivosDe(rascunho.id)).filter((k) => !k.endsWith(".pdf")).length === 4, (await arquivosDe(rascunho.id)).join(" "));

// ===== OP e observações: rascunho atualizado e guardados no sessionStorage =====
await rita.fill("#op", "43215");
await rita.fill("#obs", "Lote 7 — sem avarias");
ok("OP e observações chegam ao rascunho", await esperar("PATCH", async () => { const [l] = await rascunhos(); return l.numero_op === "43215" && l.observacoes === "Lote 7 — sem avarias"; }));
const guardado = JSON.parse(await rita.evaluate(() => sessionStorage.getItem("laudo-inspecao:rascunho")));
ok("sessionStorage guarda OP, observações e o rascunho", guardado.op === "43215" && guardado.observacoes === "Lote 7 — sem avarias" && guardado.rascunhoId === rascunho.id);

// ===== Recarregar: tudo volta =====
await rita.reload();
ok("Ao recarregar, a OP volta", await esperar("OP", async () => (await rita.inputValue("#op")) === "43215"));
ok("Ao recarregar, as observações voltam", (await rita.inputValue("#obs")) === "Lote 7 — sem avarias");
ok("Ao recarregar, as fotos enviadas voltam com a miniatura do servidor", await esperar("fotos restauradas", async () => {
  const f = await estados(rita, blocoFormulario), p = await estados(rita, blocoPecas);
  return f.join() === "pronta" && p.join() === "pronta";
}));
ok("Miniaturas restauradas vêm do servidor", (await rita.$$eval(".foto img", (l) => l.map((i) => i.src))).every((s) => s.startsWith("data:image/jpeg")));
await rita.screenshot({ path: `${S}/e-retrato.png`, fullPage: true });

// ===== Deitado: duas colunas =====
const caixa = async (sel) => rita.locator(sel).boundingBox();
const retrato = { op: await caixa(".bloco-op"), form: await caixa(blocoFormulario) };
ok("Em pé: uma coluna (OP em cima do formulário)", Math.abs(retrato.op.x - retrato.form.x) < 2 && retrato.form.y > retrato.op.y + retrato.op.height - 1);
for (const [nome, tamanho] of [["celular", { width: 915, height: 412 }], ["tablet", { width: 1280, height: 800 }]]) {
  await rita.setViewportSize(tamanho);
  await rita.waitForTimeout(300);
  const op = await caixa(".bloco-op"), form = await caixa(blocoFormulario), obs = await caixa(".bloco-obs"), botao = await caixa(".botao-enviar");
  ok(`Deitado (${nome} ${tamanho.width}x${tamanho.height}): OP e fotos lado a lado`, form.x > op.x + op.width - 1 && form.y < op.y + op.height, `op x=${op.x} w=${op.width}; form x=${form.x}`);
  ok(`Deitado (${nome}): observações na coluna da OP`, Math.abs(obs.x - op.x) < 2);
  ok(`Deitado (${nome}): botão Gerar laudo visível sem rolar`, botao.y >= 0 && botao.y + botao.height <= tamanho.height, `y=${botao.y} h=${botao.height}`);
  ok(`Deitado (${nome}): sem rolagem horizontal`, await rita.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await rita.screenshot({ path: `${S}/e-deitado-${nome}.png` });
}
await rita.mouse.wheel(0, 600);
await rita.waitForTimeout(200);
const botaoRolado = await caixa(".botao-enviar");
ok("Deitado: o botão continua à vista ao rolar as fotos", botaoRolado.y >= 0 && botaoRolado.y + botaoRolado.height <= 800);
await rita.setViewportSize({ width: 412, height: 915 });

// ===== Segurança: rascunho de outra pessoa =====
const otavio = await sessao("otavio@vanderhulst.com.br", "Outro2026x");
const alheio = [
  await api(otavio, "GET", `/api/laudos/${rascunho.id}`),
  await api(otavio, "PATCH", `/api/laudos/${rascunho.id}`, { numeroOP: "9999" }),
  await api(otavio, "POST", `/api/laudos/${rascunho.id}/imagens`, { tipo: "PECA", quantidade: 1 }),
  await api(otavio, "DELETE", `/api/laudos/${rascunho.id}/imagens/${imgs[0].id}`),
  await api(otavio, "POST", `/api/laudos/${rascunho.id}/imagens/${imgs[0].id}`),
  await api(otavio, "POST", `/api/laudos/${rascunho.id}/pdf`, { numeroOP: "9999", imagens: imgs.map((i) => i.id) }),
];
ok("Outra pessoa não vê, altera, envia, remove nem emite o rascunho alheio", alheio.every((r) => r.status === 404), alheio.map((r) => r.status).join());
ok("Rascunho alheio continua intacto", (await rascunhos())[0].numero_op === "43215" && (await imagensDe(rascunho.id)).length === 2);
const semLogin = await fetch(`${B}/api/laudos/${rascunho.id}`, { redirect: "manual" });
ok("Sem login, a API do rascunho é negada", semLogin.status === 401 || semLogin.status === 403 || semLogin.status === 307, String(semLogin.status));

// ===== Emissão protegida: foto pendente e lista diferente =====
const vaga = await api(rita, "POST", `/api/laudos/${rascunho.id}/imagens`, { tipo: "PECA", quantidade: 1 });
const idsAtuais = (await imagensDe(rascunho.id)).map((i) => i.id);
const comPendente = await api(rita, "POST", `/api/laudos/${rascunho.id}/pdf`, { numeroOP: "43215", imagens: idsAtuais });
ok("Não emite com foto ainda sem chegar", comPendente.status === 409, comPendente.corpo.erro);
const naoChegou = await api(rita, "POST", `/api/laudos/${rascunho.id}/imagens/${vaga.corpo.envios[0].id}`);
ok("Confirmar foto que não chegou ao Storage dá erro claro", naoChegou.status === 409, naoChegou.corpo.erro);
await api(rita, "DELETE", `/api/laudos/${rascunho.id}/imagens/${vaga.corpo.envios[0].id}`);
const listaErrada = await api(rita, "POST", `/api/laudos/${rascunho.id}/pdf`, { numeroOP: "43215", imagens: idsAtuais.slice(0, 1) });
ok("Não emite se a lista de fotos da tela difere do banco", listaErrada.status === 409, listaErrada.corpo.erro);
const excesso = await api(rita, "POST", `/api/laudos/${rascunho.id}/imagens`, { tipo: "FORMULARIO", quantidade: 10 });
ok("Limite de folhas do formulário vale no servidor", excesso.status === 400, excesso.corpo.erro);

// ===== Gerar o laudo =====
await rita.reload();
await esperar("restaurado", async () => (await estados(rita, blocoPecas)).join() === "pronta");
await Promise.all([rita.waitForURL(new RegExp(`/laudos/${rascunho.id}$`), { timeout: 30000 }), rita.click(".botao-enviar")]);
ok("Gerar laudo leva à confirmação", rita.url().endsWith(`/laudos/${rascunho.id}`));
const [emitido] = await rascunhos();
ok("Laudo vira EMITIDO com o PDF, OP e observações finais", emitido.status === "EMITIDO" && emitido.caminho_pdf === `${rascunho.id}/laudo-OP-43215.pdf` && emitido.observacoes === "Lote 7 — sem avarias");
imgs = await imagensDe(rascunho.id);
ok("Imagens do laudo apontam para o PDF e guardam o hash", imgs.length === 2 && imgs.every((i) => i.caminho_arquivo === emitido.caminho_pdf && i.hash_sha256));
arquivos = await arquivosDe(rascunho.id);
ok("Depois de emitir, só o PDF fica no Storage", arquivos.length === 1 && arquivos[0].endsWith(".pdf"), arquivos.join(" "));
const pdf = Buffer.from(await (await fetch(`${F}/__arquivo?k=${encodeURIComponent("laudos/" + emitido.caminho_pdf)}`)).arrayBuffer());
ok("PDF gerado", pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 50000, `${pdf.length} bytes`);
ok("sessionStorage limpo depois de emitir", (await rita.evaluate(() => sessionStorage.getItem("laudo-inspecao:rascunho"))) === null);
const depois = await api(rita, "POST", `/api/laudos/${rascunho.id}/imagens`, { tipo: "PECA", quantidade: 1 });
ok("Laudo emitido não aceita mais fotos", depois.status === 409, depois.corpo.erro);
await rita.goto(B + "/");
ok("Nova tela de envio começa vazia", await esperar("vazia", async () => (await rita.inputValue("#op")) === "" && (await rita.$$(".foto")).length === 0));

await browser.close();
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os critérios da tela de envio passaram.");
process.exit(falhas ? 1 : 0);
