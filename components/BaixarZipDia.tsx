"use client";

import { zipSync } from "fflate";
import { useState } from "react";

const DOWNLOADS_SIMULTANEOS = 4;

/**
 * Baixa todos os laudos de um dia num ZIP "dd-mm.zip" com a pasta "dd-mm/"
 * dentro, pronto para arrastar para o drive. O ZIP é montado no navegador.
 */
export default function BaixarZipDia({ dia, rotulo }: { dia: string; rotulo?: string }) {
  const [estado, setEstado] = useState<{ texto: string; erro?: boolean } | null>(null);
  const ocupado = Boolean(estado && !estado.erro && estado.texto !== "");

  async function baixar() {
    setEstado({ texto: "Preparando…" });
    try {
      const resposta = await fetch(`/api/laudos/zip?data=${dia}`);
      const lista = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(lista.erro || `Falha no servidor (HTTP ${resposta.status}).`);
      const { pasta, arquivos } = lista as { pasta: string; arquivos: { nome: string; url: string }[] };
      if (arquivos.length === 0) {
        setEstado({ texto: "Nenhum laudo emitido nesse dia.", erro: true });
        return;
      }

      const baixados: Uint8Array[] = new Array(arquivos.length);
      let prontos = 0;
      let proximo = 0;
      setEstado({ texto: `Baixando 0 de ${arquivos.length}…` });
      await Promise.all(
        Array.from({ length: Math.min(DOWNLOADS_SIMULTANEOS, arquivos.length) }, async () => {
          while (proximo < arquivos.length) {
            const i = proximo++;
            const r = await fetch(arquivos[i].url);
            if (!r.ok) throw new Error(`Falha ao baixar ${arquivos[i].nome} (HTTP ${r.status}).`);
            baixados[i] = new Uint8Array(await r.arrayBuffer());
            setEstado({ texto: `Baixando ${++prontos} de ${arquivos.length}…` });
          }
        }),
      );

      // Na ordem de emissão. PDFs já são comprimidos: nível 0 só empacota, e fica instantâneo.
      const conteudo = Object.fromEntries(arquivos.map((a, i) => [`${pasta}/${a.nome}`, baixados[i]]));
      const zip = zipSync(conteudo, { level: 0 });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      link.download = `${pasta}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      setEstado({ texto: "" });
    } catch (e) {
      setEstado({ texto: e instanceof Error ? e.message : String(e), erro: true });
    }
  }

  return (
    <span className="baixar-zip">
      <button type="button" onClick={baixar} disabled={ocupado}>
        {ocupado ? estado!.texto : (rotulo ?? "Baixar ZIP do dia")}
      </button>
      {estado?.erro && <span className="alerta">{estado.texto}</span>}
    </span>
  );
}

/** Escolha de qualquer data (dias que já saíram da lista do histórico). */
export function BaixarZipOutraData({ hoje }: { hoje: string }) {
  const [dia, setDia] = useState(hoje);
  return (
    <div className="zip-outra-data">
      <label htmlFor="dia-zip">ZIP de outra data</label>
      <div>
        <input id="dia-zip" type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} />
        {dia && <BaixarZipDia key={dia} dia={dia} rotulo="Baixar ZIP" />}
      </div>
    </div>
  );
}
