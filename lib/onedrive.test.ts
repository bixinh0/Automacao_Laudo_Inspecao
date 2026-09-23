import { afterEach, describe, expect, it, vi } from "vitest";
import { cifrar, decifrar } from "./integracao";
import { enviarArquivo, ErroOneDrive, renovarToken, resolverPasta, subpastasDoDia, type ConfigOneDrive } from "./onedrive";

const CFG: ConfigOneDrive = { tenantId: "t", clientId: "c", clientSecret: "segredo", pastaLink: "https://x" };

type Rota = (url: string, init: RequestInit) => { status: number; body?: unknown };

function simularFetch(rota: Rota) {
  const chamadas: { url: string; metodo: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url, metodo: init.method ?? "GET", init });
      const r = rota(url, init);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }),
  );
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe("subpastasDoDia", () => {
  it("ano, mês por extenso e dd-mm no fuso de São Paulo", () => {
    expect(subpastasDoDia(new Date("2026-09-23T15:00:00Z"))).toEqual(["2026", "Setembro", "23-09"]);
    expect(subpastasDoDia(new Date("2026-03-05T12:00:00Z"))).toEqual(["2026", "Março", "05-03"]);
  });
  it("laudo emitido às 23:30 em São Paulo fica no dia local, não no dia UTC", () => {
    // 02:30 UTC de 1º de março = 23:30 de 28 de fevereiro em São Paulo.
    expect(subpastasDoDia(new Date("2026-03-01T02:30:00Z"))).toEqual(["2026", "Fevereiro", "28-02"]);
    expect(subpastasDoDia(new Date("2027-01-01T01:00:00Z"))).toEqual(["2026", "Dezembro", "31-12"]);
  });
});

describe("enviarArquivo", () => {
  it("reaproveita pastas existentes, cria as que faltam e envia sem sobrescrever", async () => {
    const chamadas = simularFetch((url, init) => {
      const metodo = init.method ?? "GET";
      if (metodo === "GET" && url.includes(":/2026:")) return { status: 200, body: { id: "ano" } };
      if (metodo === "GET" && url.includes(":/Mar%C3%A7o:")) return { status: 404, body: { error: { message: "not found" } } };
      if (metodo === "POST" && url.includes("/items/ano/children")) return { status: 201, body: { id: "mes" } };
      // A pasta do dia é criada por outro envio ao mesmo tempo: 404, depois 409, depois existe.
      if (metodo === "GET" && url.includes("/items/mes:/05-03:")) {
        const jaCriada = chamadas.some((c) => c.metodo === "POST" && c.url.includes("/items/mes/children"));
        return jaCriada ? { status: 200, body: { id: "dia" } } : { status: 404, body: {} };
      }
      if (metodo === "POST" && url.includes("/items/mes/children")) return { status: 409, body: { error: { message: "exists" } } };
      if (metodo === "PUT") return { status: 201, body: { webUrl: "https://sp/laudo.pdf" } };
      return { status: 500, body: { error: { message: `inesperado ${metodo} ${url}` } } };
    });

    const url = await enviarArquivo("tok", { driveId: "d", itemId: "raiz" }, ["2026", "Março", "05-03"], "laudo-OP-123.pdf", Buffer.from("%PDF"));

    expect(url).toBe("https://sp/laudo.pdf");
    const put = chamadas.find((c) => c.metodo === "PUT")!;
    expect(put.url).toBe(
      "https://graph.microsoft.com/v1.0/drives/d/items/dia:/laudo-OP-123.pdf:/content?@microsoft.graph.conflictBehavior=rename",
    );
    expect((put.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const criacao = chamadas.find((c) => c.metodo === "POST" && c.url.includes("/items/ano/children"))!;
    expect(JSON.parse(String(criacao.init.body))).toMatchObject({ name: "Março", folder: {} });
  });

  it("propaga erro de permissão com a mensagem da Microsoft", async () => {
    simularFetch(() => ({ status: 403, body: { error: { message: "Access denied" } } }));
    await expect(enviarArquivo("tok", { driveId: "d", itemId: "r" }, ["2026"], "a.pdf", Buffer.from(""))).rejects.toThrow(
      "Access denied",
    );
  });
});

describe("resolverPasta", () => {
  it("codifica o link no formato de compartilhamento do Graph", async () => {
    const chamadas = simularFetch(() => ({ status: 200, body: { id: "pasta", folder: {}, parentReference: { driveId: "drive" } } }));
    const link = "https://vanderhulst.sharepoint.com/:f:/s/Qualidade/EabC?e=x1";
    expect(await resolverPasta("tok", link)).toEqual({ driveId: "drive", itemId: "pasta" });
    const esperado = "u!" + Buffer.from(link).toString("base64url");
    expect(chamadas[0].url).toContain(`/shares/${esperado}/driveItem`);
  });

  it("recusa link de arquivo", async () => {
    simularFetch(() => ({ status: 200, body: { id: "x", file: {}, parentReference: { driveId: "d" } } }));
    await expect(resolverPasta("tok", "https://x/arquivo.pdf")).rejects.toBeInstanceOf(ErroOneDrive);
  });
});

describe("tokens", () => {
  it("mantém o refresh token anterior quando a Microsoft não devolve um novo", async () => {
    simularFetch(() => ({ status: 200, body: { access_token: "a", expires_in: 3600 } }));
    expect((await renovarToken(CFG, "r-antigo")).refreshToken).toBe("r-antigo");
  });

  it("explica a recusa da Microsoft", async () => {
    simularFetch(() => ({ status: 400, body: { error: "invalid_grant", error_description: "AADSTS70008: expired\r\nTrace" } }));
    await expect(renovarToken(CFG, "r")).rejects.toThrow("A Microsoft recusou a autorização: AADSTS70008: expired");
  });

  it("cifra o refresh token e só decifra com o mesmo segredo", () => {
    const cifrado = cifrar("meu-refresh-token", CFG);
    expect(cifrado).not.toContain("meu-refresh-token");
    expect(decifrar(cifrado, CFG)).toBe("meu-refresh-token");
    expect(() => decifrar(cifrado, { ...CFG, clientSecret: "outro" })).toThrow();
  });
});
