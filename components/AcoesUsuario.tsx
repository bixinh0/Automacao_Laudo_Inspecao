"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEPARTAMENTOS, LISTA_DEPARTAMENTOS, type Departamento } from "@/lib/contas";
import type { AcaoUsuario } from "@/lib/permissoes";

const ROTULOS: Record<AcaoUsuario, string> = {
  APROVAR: "Aprovar",
  RECUSAR: "Recusar",
  SUSPENDER: "Suspender",
  PROMOVER: "Promover a ADMIN",
  REBAIXAR: "Rebaixar para usuário",
  EDITAR: "Editar",
  REDEFINIR_SENHA: "Redefinir senha",
  REMOVER: "Remover",
};

const CONFIRMAR: Partial<Record<AcaoUsuario, (nome: string) => string>> = {
  SUSPENDER: (n) => `Suspender o acesso de ${n}?`,
  PROMOVER: (n) => `Promover ${n} a ADMIN?`,
  REBAIXAR: (n) => `Rebaixar ${n} para usuário?`,
  REDEFINIR_SENHA: (n) => `Gerar uma senha provisória para ${n}? A senha atual deixa de funcionar.`,
  REMOVER: (n) => `Remover ${n} definitivamente? Esta ação não pode ser desfeita.`,
};

/**
 * Botões de ação de um usuário. Recebe só as ações que o servidor já calculou
 * como permitidas — mas é o servidor (e o banco) que decide de fato.
 */
export default function AcoesUsuario({
  id,
  nome,
  departamento,
  acoes,
  destaque = false,
}: {
  id: string;
  nome: string;
  departamento: Departamento;
  acoes: AcaoUsuario[];
  destaque?: boolean;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"botoes" | "recusar" | "editar">("botoes");
  const [motivo, setMotivo] = useState("");
  const [novoNome, setNovoNome] = useState(nome);
  const [novoDep, setNovoDep] = useState<string>(departamento);
  const [erro, setErro] = useState("");
  const [senha, setSenha] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: AcaoUsuario, extras: Record<string, string> = {}) {
    const pergunta = CONFIRMAR[acao]?.(nome);
    if (pergunta && !window.confirm(pergunta)) return;
    setOcupado(true);
    setErro("");
    try {
      const r = await fetch(`/api/usuarios/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, ...extras }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro || `Falha no servidor (HTTP ${r.status}).`);
      if (dados.senhaProvisoria) {
        setSenha(dados.senhaProvisoria); // exibida só aqui, uma única vez
        return;
      }
      setModo("botoes");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  if (senha) {
    return (
      <div className="senha-provisoria" role="alert">
        <p>
          Senha provisória de <strong>{nome}</strong> (válida por 24 h, troca obrigatória no primeiro acesso):
        </p>
        <code>{senha}</code>
        <div className="acoes">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(senha).catch(() => undefined);
              setCopiada(true);
            }}
          >
            {copiada ? "Copiada" : "Copiar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSenha(null);
              router.refresh();
            }}
          >
            Já repassei — fechar
          </button>
        </div>
        <p className="ajuda">Ela não será exibida de novo. Repasse pessoalmente ou por canal interno.</p>
      </div>
    );
  }

  if (modo === "recusar") {
    return (
      <div className="acao-formulario">
        <label htmlFor={`motivo-${id}`}>Motivo da recusa (opcional)</label>
        <textarea id={`motivo-${id}`} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        {erro && <p className="alerta">{erro}</p>}
        <div className="acoes">
          <button type="button" className="perigo" disabled={ocupado} onClick={() => executar("RECUSAR", { motivo })}>
            Confirmar recusa
          </button>
          <button type="button" onClick={() => setModo("botoes")}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (modo === "editar") {
    return (
      <div className="acao-formulario">
        <label htmlFor={`nome-${id}`}>Nome completo</label>
        <input id={`nome-${id}`} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <label htmlFor={`dep-${id}`}>Departamento</label>
        <select id={`dep-${id}`} value={novoDep} onChange={(e) => setNovoDep(e.target.value)}>
          {LISTA_DEPARTAMENTOS.map((d) => (
            <option key={d} value={d}>
              {DEPARTAMENTOS[d]}
            </option>
          ))}
        </select>
        {erro && <p className="alerta">{erro}</p>}
        <div className="acoes">
          <button type="button" disabled={ocupado} onClick={() => executar("EDITAR", { nome: novoNome, departamento: novoDep })}>
            Salvar
          </button>
          <button type="button" onClick={() => setModo("botoes")}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (acoes.length === 0) return null;
  return (
    <div className={`acoes${destaque ? " destaque" : ""}`}>
      {acoes.map((acao) => (
        <button
          key={acao}
          type="button"
          disabled={ocupado}
          className={acao === "APROVAR" ? "primario" : acao === "REMOVER" || acao === "RECUSAR" ? "perigo" : ""}
          onClick={() => (acao === "RECUSAR" ? setModo("recusar") : acao === "EDITAR" ? setModo("editar") : executar(acao))}
        >
          {ROTULOS[acao]}
        </button>
      ))}
      {erro && <p className="alerta">{erro}</p>}
    </div>
  );
}
