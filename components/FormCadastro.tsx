"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CampoSenha from "@/components/CampoSenha";
import { DEPARTAMENTOS, emailDoDominio, LISTA_DEPARTAMENTOS, MENSAGEM_DOMINIO, problemaSenha } from "@/lib/contas";

export default function FormCadastro({ dominio }: { dominio: string }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tocado, setTocado] = useState<Record<string, boolean>>({});

  // Retorno imediato; o servidor valida tudo de novo.
  const problemas = {
    nome: nome.trim().length < 3 ? "Informe o nome completo." : null,
    email: !emailDoDominio(email, dominio) ? MENSAGEM_DOMINIO(dominio || "vanderhulst.com.br") : null,
    departamento: !departamento ? "Escolha o departamento." : null,
    senha: problemaSenha(senha),
    confirmacao: confirmacao !== senha ? "A confirmação não é igual à senha." : null,
  };
  const valido = Object.values(problemas).every((p) => !p);
  const mostrar = (campo: keyof typeof problemas) =>
    tocado[campo] && problemas[campo] ? <p className="ajuda alerta">{problemas[campo]}</p> : null;
  const tocar = (campo: string) => () => setTocado((t) => ({ ...t, [campo]: true }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTocado({ nome: true, email: true, departamento: true, senha: true, confirmacao: true });
    if (!valido || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, departamento, senha, confirmacao }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro || `Falha no servidor (HTTP ${r.status}).`);
      router.push("/aguardando?situacao=PENDENTE&novo=1");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} noValidate>
      <h1>Criar acesso</h1>
      <p className="ajuda">Seu cadastro será analisado por um administrador antes de liberar o acesso.</p>

      <div className="campo">
        <label htmlFor="nome">Nome completo</label>
        <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={tocar("nome")} autoComplete="name" required />
        {mostrar("nome")}
      </div>
      <div className="campo">
        <label htmlFor="email">E-mail corporativo</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder={`nome@${dominio || "vanderhulst.com.br"}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={tocar("email")}
          required
        />
        {mostrar("email")}
      </div>
      <div className="campo">
        <label htmlFor="departamento">Departamento</label>
        <select id="departamento" value={departamento} onChange={(e) => setDepartamento(e.target.value)} onBlur={tocar("departamento")} required>
          <option value="">Selecione…</option>
          {LISTA_DEPARTAMENTOS.map((d) => (
            <option key={d} value={d}>
              {DEPARTAMENTOS[d]}
            </option>
          ))}
        </select>
        {mostrar("departamento")}
      </div>
      <div onBlur={tocar("senha")}>
        <CampoSenha id="senha" rotulo="Senha" valor={senha} aoMudar={setSenha} autoComplete="new-password" comForca />
        <p className="ajuda">Mínimo de 8 caracteres, com letras e números.</p>
        {mostrar("senha")}
      </div>
      <div onBlur={tocar("confirmacao")}>
        <CampoSenha id="confirmacao" rotulo="Confirme a senha" valor={confirmacao} aoMudar={setConfirmacao} autoComplete="new-password" />
        {mostrar("confirmacao")}
      </div>

      {erro && (
        <p className="alerta" role="alert">
          {erro}
        </p>
      )}
      <button type="submit" className="botao-enviar" disabled={enviando}>
        {enviando ? "Enviando…" : "Cadastrar"}
      </button>
      <p className="ajuda rodape-form">
        Já tem acesso? <Link href="/entrar">Entrar</Link>
      </p>
    </form>
  );
}
