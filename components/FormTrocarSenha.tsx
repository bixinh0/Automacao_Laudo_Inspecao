"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import CampoSenha from "@/components/CampoSenha";
import { problemaSenha } from "@/lib/contas";

/** Troca da própria senha. Obrigatória: sem senha atual. Voluntária (Meu perfil): pede a atual. */
export default function FormTrocarSenha({ obrigatoria = false }: { obrigatoria?: boolean }) {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const problema = (!obrigatoria && !atual ? "Informe a senha atual." : null) || problemaSenha(nova) || (nova !== confirmacao ? "A confirmação não é igual à nova senha." : null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (problema) {
      setErro(problema);
      return;
    }
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/auth/trocar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atual: obrigatoria ? undefined : atual, nova, confirmacao }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados.erro || `Falha no servidor (HTTP ${r.status}).`);
      if (obrigatoria) {
        router.replace("/");
        router.refresh();
        return;
      }
      setOk(true);
      setAtual("");
      setNova("");
      setConfirmacao("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      {!obrigatoria && <CampoSenha id="atual" rotulo="Senha atual" valor={atual} aoMudar={setAtual} autoComplete="current-password" />}
      <CampoSenha id="nova" rotulo="Nova senha" valor={nova} aoMudar={setNova} autoComplete="new-password" comForca autoFocus={obrigatoria} />
      <p className="ajuda">Mínimo de 8 caracteres, com letras e números.</p>
      <CampoSenha id="confirmacao-nova" rotulo="Confirme a nova senha" valor={confirmacao} aoMudar={setConfirmacao} autoComplete="new-password" />
      {erro && (
        <p className="alerta" role="alert">
          {erro}
        </p>
      )}
      {ok && <p className="aviso-ok">Senha alterada.</p>}
      <button type="submit" className="botao-enviar" disabled={enviando}>
        {enviando ? "Salvando…" : obrigatoria ? "Salvar e continuar" : "Trocar senha"}
      </button>
    </form>
  );
}
