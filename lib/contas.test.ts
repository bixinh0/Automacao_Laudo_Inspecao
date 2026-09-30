import { describe, expect, it } from "vitest";
import { emailDoDominio, forcaSenha, LISTA_DEPARTAMENTOS, DEPARTAMENTOS, normalizarEmail, problemaSenha } from "./contas";

const D = "vanderhulst.com.br";

describe("domínio do e-mail", () => {
  it.each([
    ["luan.godoi@vanderhulst.com.br", true],
    ["  Luan.Godoi@VanderHulst.com.BR  ", true],
    ["usuario@sub.vanderhulst.com.br", false],
    ["usuario@vanderhulst.com", false],
    ["usuario@vanderhulst.com.br.evil.com", false],
    ["usuario@gmail.com", false],
    ["usuario@evilvanderhulst.com.br", false],
    ["a@b@vanderhulst.com.br", false],
    ["@vanderhulst.com.br", false],
    ["usuario vanderhulst.com.br", false],
    ["", false],
  ])("%s → %s", (email, esperado) => {
    expect(emailDoDominio(email, D)).toBe(esperado);
  });
  it("sem domínio configurado, recusa tudo", () => {
    expect(emailDoDominio("luan.godoi@vanderhulst.com.br", "")).toBe(false);
  });
  it("normaliza espaços e maiúsculas", () => {
    expect(normalizarEmail("  A@B.C ")).toBe("a@b.c");
  });
});

describe("política de senha", () => {
  it.each([
    ["curta1", "pelo menos 8"],
    ["somenteletras", "número"],
    ["12345678", "letra"],
    ["Van@123", "pelo menos 8"],
  ])("%s é recusada", (senha, trecho) => {
    expect(problemaSenha(senha)).toContain(trecho);
  });
  it.each(["abcdefg1", "Qualidade2026", "senha segura 9"])("%s é aceita", (senha) => {
    expect(problemaSenha(senha)).toBeNull();
  });
  it("indicador de força cresce com tamanho e variedade", () => {
    expect(forcaSenha("").nivel).toBe(0);
    expect(forcaSenha("abc").rotulo).toBe("Fraca");
    expect(forcaSenha("abcdefg1").nivel).toBeLessThan(forcaSenha("Abcdefgh1234!").nivel);
    expect(forcaSenha("Abcdefgh1234!").rotulo).toBe("Forte");
  });
});

describe("departamentos", () => {
  it("lista fechada, em ordem alfabética", () => {
    expect(LISTA_DEPARTAMENTOS.map((d) => DEPARTAMENTOS[d])).toEqual([
      "Administrativo",
      "Comercial",
      "Engenharia",
      "Logística",
      "Produção",
      "Qualidade",
      "Recursos Humanos",
      "Suporte Técnico",
      "Suprimentos",
    ]);
  });
});
