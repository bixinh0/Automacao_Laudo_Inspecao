// Supabase simulado para os testes de ponta a ponta: PostgREST, Storage e Auth mínimos, em memória.
// Não aplica RLS: as regras do banco são testadas à parte em scripts/testar-banco.sh.
import http from "node:http";
import { randomUUID } from "node:crypto";

const tabelas = { laudo: [], imagem: [], integracao: [], profiles: [], log_auditoria: [], tentativas_login: [] };
// ---- Supabase Auth simulado ----
const loginsAuth = new Map(); // id -> { id, email, senha, criado }
const tokens = new Map();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const usuarioAuth = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.criado, app_metadata: { provider: "email" }, user_metadata: {}, created_at: u.criado, updated_at: u.criado });
function sessaoAuth(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600, session_id: randomUUID() }) + ".assinatura";
  const refresh = randomUUID();
  tokens.set(access, u.id); tokens.set("r:" + refresh, u.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: usuarioAuth(u) };
}
const arquivos = new Map(); // "bucket/path" -> {buf, type}
const log = [];

function lerCorpo(req) {
  return new Promise((r) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => r(Buffer.concat(partes)));
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function filtrar(linhas, params) {
  let r = [...linhas];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...resto] = v.split(".");
    const val = resto.join(".");
    if (op === "eq") r = r.filter((l) => String(l[k]) === val);
    else if (op === "not" && val === "is.null") r = r.filter((l) => l[k] != null);
    else if (op === "neq") r = r.filter((l) => String(l[k]) !== val);
    else if (op === "is" && val === "null") r = r.filter((l) => l[k] == null);
    else if (op === "in") { const lista = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); r = r.filter((l) => lista.includes(String(l[k]))); }
    else if (op === "gte") r = r.filter((l) => String(l[k]) >= val);
    else if (op === "lt") r = r.filter((l) => String(l[k]) < val);
    else if (op === "like") {
      const re = new RegExp("^" + val.replace(/[*%]/g, ".*") + "$");
      r = r.filter((l) => re.test(String(l[k])));
    } else throw new Error("filtro não suportado " + k + "=" + v);
  }
  const orders = params.getAll("order");
  for (const o of orders.reverse()) {
    for (const parte of o.split(",").reverse()) {
      const [col, dir] = parte.split(".");
      r.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
    }
  }
  if (params.get("limit")) r = r.slice(0, Number(params.get("limit")));
  return r;
}

function responderLinhas(req, res, linhas, status = 200) {
  if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
    if (linhas.length !== 1) return json(res, 406, { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" });
    return json(res, status, linhas[0]);
  }
  return json(res, status, linhas);
}

function multipartArquivo(buf, contentType) {
  const limite = "--" + contentType.split("boundary=")[1];
  const texto = buf.toString("latin1");
  const partes = texto.split(limite).slice(1, -1);
  for (const p of partes) {
    const [cab, ...corpo] = p.split("\r\n\r\n");
    if (/filename=/.test(cab)) {
      const conteudo = corpo.join("\r\n\r\n").replace(/\r\n$/, "");
      const tipo = (cab.match(/Content-Type: (.*)/i) || [])[1];
      return { buf: Buffer.from(conteudo, "latin1"), type: tipo };
    }
  }
  throw new Error("sem arquivo no multipart");
}

const servidor = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, "http://x");
  const corpo = await lerCorpo(req);
  log.push(`${req.method} ${url.pathname}${url.search}`);
  try {
    // ---------- Auth ----------
    let ma;
    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      const b = JSON.parse(corpo.toString());
      if ([...loginsAuth.values()].some((u) => u.email === b.email)) return json(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const u = { id: randomUUID(), email: b.email, senha: b.password, criado: new Date().toISOString() };
      loginsAuth.set(u.id, u);
      return json(res, 200, usuarioAuth(u));
    }
    if (url.pathname === "/auth/v1/admin/users" && req.method === "GET") return json(res, 200, { users: [...loginsAuth.values()].map(usuarioAuth), aud: "authenticated" });
    if ((ma = url.pathname.match(/^\/auth\/v1\/admin\/users\/([\w-]+)$/))) {
      const u = loginsAuth.get(ma[1]);
      if (!u) return json(res, 404, { code: 404, error_code: "user_not_found", msg: "User not found" });
      if (req.method === "PUT") { const b = JSON.parse(corpo.toString()); if (b.password) u.senha = b.password; log.push("AUTH senha alterada " + u.email); return json(res, 200, usuarioAuth(u)); }
      if (req.method === "DELETE") { loginsAuth.delete(u.id); return json(res, 200, {}); }
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const b = JSON.parse(corpo.toString());
      if (url.searchParams.get("grant_type") === "password") {
        const u = [...loginsAuth.values()].find((x) => x.email === b.email && x.senha === b.password);
        if (!u) return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return json(res, 200, sessaoAuth(u));
      }
      const id = tokens.get("r:" + b.refresh_token);
      if (!id || !loginsAuth.has(id)) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return json(res, 200, sessaoAuth(loginsAuth.get(id)));
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const t = (req.headers.authorization || "").replace(/^Bearer /, "");
      const id = tokens.get(t);
      if (!id || !loginsAuth.has(id)) return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      return json(res, 200, usuarioAuth(loginsAuth.get(id)));
    }
    if (url.pathname === "/auth/v1/logout") { tokens.delete((req.headers.authorization || "").replace(/^Bearer /, "")); res.writeHead(204); return res.end(); }

    // ---------- RPC (migration 0003) ----------
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const args = corpo.length ? JSON.parse(corpo.toString()) : {};
      const doBucket = [...arquivos.entries()].filter(([k]) => k.startsWith("laudos/"));
      const total = doBucket.reduce((t, [, v]) => t + v.buf.length, 0);
      const comPdf = tabelas.laudo.filter((l) => l.caminho_pdf && !l.pdf_removido_em && arquivos.has("laudos/" + l.caminho_pdf));
      if (rpc[1] === "uso_armazenamento_laudos") {
        const antigo = comPdf.map((l) => l.criado_em).sort()[0] ?? null;
        return responderLinhas(req, res, [{ bytes_total: total, mais_antigo: antigo }]);
      }
      if (rpc[1] === "laudos_para_liberar_espaco") {
        const pdfs = new Set(comPdf.map((l) => "laudos/" + l.caminho_pdf));
        let acumulado = doBucket.filter(([k]) => !pdfs.has(k)).reduce((t, [, v]) => t + v.buf.length, 0);
        const sair = [];
        for (const l of [...comPdf].sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))) {
          acumulado += arquivos.get("laudos/" + l.caminho_pdf).buf.length;
          if (acumulado > args.limite_bytes) sair.push({ id: l.id, caminho_pdf: l.caminho_pdf, criado_em: l.criado_em });
        }
        return json(res, 200, sair.sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1)).map(({ id, caminho_pdf }) => ({ id, caminho_pdf })));
      }
    }
    if (url.pathname === "/storage/v1/object/list/laudos" && req.method === "POST") {
      const { prefix } = JSON.parse(corpo.toString());
      const nomes = [...arquivos.keys()].filter((k) => k.startsWith("laudos/" + prefix + "/")).map((k) => ({ name: k.slice(("laudos/" + prefix + "/").length) }));
      return json(res, 200, nomes);
    }
    // ---------- PostgREST ----------
    const rest = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (rest) {
      const tabela = tabelas[rest[1]];
      if (req.method === "GET") return responderLinhas(req, res, filtrar(tabela, url.searchParams));
      if (req.method === "POST") {
        const dados = JSON.parse(corpo.toString());
        const lista = Array.isArray(dados) ? dados : [dados];
        const conflito = url.searchParams.get("on_conflict");
        const resultado = [];
        for (const d of lista) {
          if (rest[1] === "laudo" && !/^[0-9]{4,8}$/.test(d.numero_op)) return json(res, 400, { message: "check violation" });
          if (rest[1] === "imagem" && !conflito && tabela.some((l) => l.laudo_id === d.laudo_id && l.tipo === d.tipo && l.ordem === d.ordem)) {
            return json(res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
          }
          let existente = conflito && tabela.find((l) => conflito.split(",").every((c) => String(l[c]) === String(d[c])));
          if (existente) Object.assign(existente, d);
          else {
            existente = { id: randomUUID(), criado_em: new Date().toISOString(), ...(rest[1] === "laudo" ? { caminho_pdf: null, observacoes: null, status: "RASCUNHO" } : {}), ...(rest[1] === "imagem" ? { hash_sha256: null, largura: null, altura: null, recebida_em: null } : {}), ...(rest[1] === "profiles" ? { papel: "USUARIO", situacao: "PENDENTE", senha_provisoria: false, provisoria_expira: null, motivo_recusa: null, decidido_por: null, decidido_em: null } : {}), ...d };
            tabela.push(existente);
          }
          resultado.push(existente);
        }
        return responderLinhas(req, res, resultado, 201);
      }
      if (req.method === "DELETE") {
        const alvo = filtrar(tabela, url.searchParams);
        tabelas[rest[1]] = tabela.filter((l) => !alvo.includes(l));
        if ((req.headers.prefer || "").includes("return=representation")) return json(res, 200, alvo);
        res.writeHead(204); return res.end();
      }
      if (req.method === "PATCH") {
        const dados = JSON.parse(corpo.toString());
        const alvo = filtrar(tabela, url.searchParams);
        alvo.forEach((l) => Object.assign(l, dados));
        return responderLinhas(req, res, alvo);
      }
    }
    // ---------- Storage ----------
    let m;
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/(.+)$/))) {
      const chave = decodeURIComponent(m[1]);
      if (req.method === "POST") return json(res, 200, { url: `/object/upload/sign/${m[1]}?token=tok-${encodeURIComponent(chave)}` });
      if (req.method === "PUT") {
        if (url.searchParams.get("token") !== `tok-${chave}`) return json(res, 400, { message: "token inválido" });
        const arq = multipartArquivo(corpo, req.headers["content-type"]);
        arquivos.set(chave, arq);
        log.push(`ENVIO ${chave} ${arq.buf.length} bytes ${arq.type}`);
        return json(res, 200, { Key: chave });
      }
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/sign\/(.+)$/))) {
      const chave = decodeURIComponent(m[1]);
      if (req.method === "POST") {
        const pedido = corpo.length ? JSON.parse(corpo.toString()) : {};
        if (pedido.paths) return json(res, 200, pedido.paths.map((p) => ({ path: p, error: null, signedURL: `/object/sign/${m[1]}/${p}?token=dl` })));
        return json(res, 200, { signedURL: `/object/sign/${m[1]}?token=dl` });
      }
      if (req.method === "GET") {
        const a = arquivos.get(chave);
        if (!a) return json(res, 404, { message: "not found" });
        const headers = { "Content-Type": a.type };
        if (url.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename="${url.searchParams.get("download")}"`;
        res.writeHead(200, headers);
        return res.end(a.buf);
      }
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/(laudos)$/)) && req.method === "DELETE") {
      const { prefixes } = JSON.parse(corpo.toString());
      for (const p of prefixes) arquivos.delete(`laudos/${p}`);
      return json(res, 200, []);
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/(.+)$/))) {
      const chave = decodeURIComponent(m[1]);
      if (req.method === "GET") {
        const a = arquivos.get(chave);
        if (!a) return json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        res.writeHead(200, { "Content-Type": a.type });
        return res.end(a.buf);
      }
      if (req.method === "POST" || req.method === "PUT") {
        arquivos.set(chave, { buf: corpo, type: req.headers["content-type"] });
        return json(res, 200, { Key: chave, Id: randomUUID() });
      }
    }
    // ---------- inspeção para o teste ----------
    if (url.pathname === "/__estado") {
      return json(res, 200, {
        tabelas,
        arquivos: [...arquivos.entries()].map(([k, v]) => ({ k, bytes: v.buf.length, type: v.type })),
        log,
      });
    }
    if (url.pathname === "/__arquivo") {
      const a = arquivos.get(url.searchParams.get("k"));
      res.writeHead(a ? 200 : 404);
      return res.end(a?.buf);
    }
    json(res, 404, { message: "rota não simulada: " + req.method + " " + url.pathname });
  } catch (e) {
    console.error(e);
    json(res, 500, { message: String(e) });
  }
});

servidor.listen(54321, () => console.log("supabase falso em :54321"));
