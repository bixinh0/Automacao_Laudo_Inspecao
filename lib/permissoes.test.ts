import { describe, expect, it } from "vitest";
import { ACOES, motivoRecusa, type AcaoUsuario, type Pessoa } from "./permissoes";

const OWNER: Pessoa = { id: "owner", papel: "OWNER", situacao: "APROVADO" };
const ADMIN: Pessoa = { id: "admin", papel: "ADMIN", situacao: "APROVADO" };
const ADMIN2: Pessoa = { id: "admin2", papel: "ADMIN", situacao: "APROVADO" };
const USUARIO: Pessoa = { id: "usuario", papel: "USUARIO", situacao: "APROVADO" };
const PENDENTE: Pessoa = { id: "pendente", papel: "USUARIO", situacao: "PENDENTE" };
const RECUSADO: Pessoa = { id: "recusado", papel: "USUARIO", situacao: "RECUSADO" };
const SUSPENSO: Pessoa = { id: "suspenso", papel: "USUARIO", situacao: "SUSPENSO" };
const ADMIN_SUSPENSO: Pessoa = { id: "admsusp", papel: "ADMIN", situacao: "SUSPENSO" };

const pode = (ator: Pessoa, alvo: Pessoa, acao: AcaoUsuario) => motivoRecusa(ator, alvo, acao) === null;

describe("ninguém além do próprio OWNER age sobre o OWNER", () => {
  it.each(ACOES)("ADMIN não consegue %s o OWNER", (acao) => {
    expect(pode(ADMIN, OWNER, acao)).toBe(false);
  });
  it.each(ACOES)("USUARIO não consegue %s o OWNER", (acao) => {
    expect(pode(USUARIO, OWNER, acao)).toBe(false);
  });
});

describe("o OWNER sobre si mesmo", () => {
  it.each(["REBAIXAR", "SUSPENDER", "REMOVER", "RECUSAR", "PROMOVER", "APROVAR"] as AcaoUsuario[])(
    "não consegue %s a si mesmo",
    (acao) => {
      expect(pode(OWNER, OWNER, acao)).toBe(false);
    },
  );
  it("edita o próprio cadastro", () => expect(pode(OWNER, OWNER, "EDITAR")).toBe(true));
  it("troca a própria senha por Meu perfil, não por redefinição", () =>
    expect(motivoRecusa(OWNER, OWNER, "REDEFINIR_SENHA")).toContain("Meu perfil"));
});

describe("ADMIN", () => {
  it("não promove ninguém a ADMIN", () => expect(pode(ADMIN, USUARIO, "PROMOVER")).toBe(false));
  it.each(ACOES)("não consegue %s outro ADMIN", (acao) => {
    expect(pode(ADMIN, ADMIN2, acao)).toBe(false);
  });
  it("aprova, recusa, suspende, edita, redefine senha e remove usuários", () => {
    expect(pode(ADMIN, PENDENTE, "APROVAR")).toBe(true);
    expect(pode(ADMIN, PENDENTE, "RECUSAR")).toBe(true);
    expect(pode(ADMIN, USUARIO, "SUSPENDER")).toBe(true);
    expect(pode(ADMIN, USUARIO, "EDITAR")).toBe(true);
    expect(pode(ADMIN, USUARIO, "REDEFINIR_SENHA")).toBe(true);
    expect(pode(ADMIN, USUARIO, "REMOVER")).toBe(true);
  });
  it("reverte decisões: aprova recusado e suspenso", () => {
    expect(pode(ADMIN, RECUSADO, "APROVAR")).toBe(true);
    expect(pode(ADMIN, SUSPENSO, "APROVAR")).toBe(true);
  });
  it("ADMIN suspenso não gerencia ninguém", () => {
    for (const acao of ACOES) expect(pode(ADMIN_SUSPENSO, PENDENTE, acao)).toBe(false);
  });
});

describe("OWNER sobre os outros", () => {
  it("promove usuário aprovado e rebaixa ADMIN", () => {
    expect(pode(OWNER, USUARIO, "PROMOVER")).toBe(true);
    expect(pode(OWNER, ADMIN, "REBAIXAR")).toBe(true);
  });
  it("não promove pendente nem rebaixa quem não é ADMIN", () => {
    expect(pode(OWNER, PENDENTE, "PROMOVER")).toBe(false);
    expect(pode(OWNER, USUARIO, "REBAIXAR")).toBe(false);
  });
  it.each(["SUSPENDER", "EDITAR", "REDEFINIR_SENHA", "REMOVER"] as AcaoUsuario[])("pode %s um ADMIN", (acao) => {
    expect(pode(OWNER, ADMIN, acao)).toBe(true);
  });
});

describe("ninguém muda o próprio papel ou situação", () => {
  it.each(["APROVAR", "SUSPENDER", "PROMOVER", "REBAIXAR", "REMOVER", "REDEFINIR_SENHA"] as AcaoUsuario[])(
    "ADMIN não consegue %s a si mesmo",
    (acao) => {
      expect(pode(ADMIN, ADMIN, acao)).toBe(false);
    },
  );
});

describe("usuário comum", () => {
  it.each(ACOES)("não consegue %s ninguém", (acao) => {
    expect(pode(USUARIO, PENDENTE, acao)).toBe(false);
    expect(pode(USUARIO, SUSPENSO, acao)).toBe(false);
  });
});

describe("coerência das transições", () => {
  it("só recusa pendente; só suspende aprovado; não reaprova aprovado", () => {
    expect(pode(ADMIN, USUARIO, "RECUSAR")).toBe(false);
    expect(pode(ADMIN, PENDENTE, "SUSPENDER")).toBe(false);
    expect(pode(ADMIN, USUARIO, "APROVAR")).toBe(false);
  });
});
