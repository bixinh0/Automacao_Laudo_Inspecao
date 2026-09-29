"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEPARTAMENTOS, LISTA_DEPARTAMENTOS, type Departamento } from "@/lib/contas";

export default function FormPerfil({ nome: nomeInicial, departamento: depInicial }: { nome: string; departamento: Departamento }) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [departamento, setDepartamento] = useState<string>(depInicial);
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMensagem(null);
    try {
      const r = await fetch("/api/perfil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, departamento }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro || `Falha no servidor (HTTP ${r.status}).`);
      setMensagem({ texto: "Dados salvos." });
      router.refresh();
    } catch (e) {
      setMensagem({ texto: e instanceof Error ? e.message : String(e), erro: true });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      <div className="campo">
        <label htmlFor="perfil-nome">Nome completo</label>
        <input id="perfil-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required minLength={3} />
      </div>
      <div className="campo">
        <label htmlFor="perfil-dep">Departamento</label>
        <select id="perfil-dep" value={departamento} onChange={(e) => setDepartamento(e.target.value)}>
          {LISTA_DEPARTAMENTOS.map((d) => (
            <option key={d} value={d}>
              {DEPARTAMENTOS[d]}
            </option>
          ))}
        </select>
      </div>
      {mensagem && <p className={mensagem.erro ? "alerta" : "aviso-ok"}>{mensagem.texto}</p>}
      <button type="submit" className="botao-enviar" disabled={enviando || (nome === nomeInicial && departamento === depInicial)}>
        {enviando ? "Salvando…" : "Salvar"}
      </button>
    </form>
  );
}
