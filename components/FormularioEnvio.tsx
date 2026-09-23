"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CODIGO_FORMULARIO,
  MAX_BYTES_ARQUIVO,
  MAX_FOLHAS_FORMULARIO,
  MAX_FOTOS_PECAS,
  MAX_OBSERVACOES,
  opValida,
  type TipoImagem,
} from "@/lib/regras";
import { reduzirFoto } from "@/lib/reduzirFoto";

interface Anexo {
  id: string;
  arquivo: File;
  miniatura: string;
}

type Fase = "preenchendo" | "enviando" | "gerando" | "erro";

/** Envio em andamento, guardado para retomar de onde parou se a conexão cair. */
interface Sessao {
  laudoId: string;
  urls: Map<string, string>;
  concluidas: Set<string>;
  criadaEm: number;
}

// As URLs de envio assinadas valem 2 horas; depois disso recomeça do zero.
const VALIDADE_SESSAO_MS = 90 * 60 * 1000;
const ENVIOS_SIMULTANEOS = 3;

let contadorAnexos = 0;

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

async function postJson<T>(url: string, corpo: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e toque em Tentar novamente.");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `Falha no servidor (HTTP ${resposta.status}).`);
  return dados as T;
}

/** Envia o arquivo direto ao Storage pela URL assinada, informando o progresso. */
function enviarArquivo(url: string, arquivo: Blob, nome: string, aoProgredir: (fracao: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Falha ao enviar a foto "${nome}" (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("A conexão caiu durante o envio. Toque em Tentar novamente para continuar de onde parou."));
    const corpo = new FormData();
    corpo.append("cacheControl", "3600");
    corpo.append("", arquivo, nome);
    xhr.send(corpo);
  });
}

async function emParalelo<T>(itens: T[], limite: number, tarefa: (item: T) => Promise<void>) {
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) await tarefa(itens[proximo++]);
    }),
  );
}

function BlocoFotos({
  titulo,
  instrucao,
  rotuloBotao,
  anexos,
  contador,
  aoAdicionar,
  aoRemover,
  desabilitado,
}: {
  titulo: string;
  instrucao: string;
  rotuloBotao: string;
  anexos: Anexo[];
  contador: string;
  aoAdicionar: (e: ChangeEvent<HTMLInputElement>) => void;
  aoRemover: (id: string) => void;
  desabilitado: boolean;
}) {
  return (
    <section className="bloco">
      <h2>{titulo}</h2>
      <p className="ajuda">{instrucao}</p>
      <label className={`botao-foto${desabilitado ? " desabilitado" : ""}`}>
        <span aria-hidden="true">📷</span> {rotuloBotao}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={aoAdicionar}
          disabled={desabilitado}
          className="oculto"
        />
      </label>
      <p className={`contador${anexos.length ? " ok" : ""}`} aria-live="polite">
        {contador}
      </p>
      {anexos.length > 0 && (
        <ul className="miniaturas">
          {anexos.map((a, i) => (
            <li key={a.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.miniatura} alt={`Foto ${i + 1}`} loading="lazy" decoding="async" />
              <span className="numero">{i + 1}</span>
              {!desabilitado && (
                <button type="button" className="remover" onClick={() => aoRemover(a.id)} aria-label={`Remover foto ${i + 1}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function FormularioEnvio() {
  const router = useRouter();
  const [op, setOp] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [formularios, setFormularios] = useState<Anexo[]>([]);
  const [pecas, setPecas] = useState<Anexo[]>([]);
  const [fase, setFase] = useState<Fase>("preenchendo");
  const [progresso, setProgresso] = useState(0);
  const [etapa, setEtapa] = useState("");
  const [mensagemErro, setMensagemErro] = useState("");
  const [aviso, setAviso] = useState("");
  const sessao = useRef<Sessao | null>(null);
  // Fotos já reduzidas, por anexo: numa nova tentativa não precisa reduzir de novo.
  const reduzidas = useRef(new Map<string, Blob>());

  // Libera a memória das miniaturas ao sair da tela.
  const anexosRef = useRef<Anexo[]>([]);
  anexosRef.current = [...formularios, ...pecas];
  useEffect(() => () => anexosRef.current.forEach((a) => URL.revokeObjectURL(a.miniatura)), []);

  const ocupado = fase === "enviando" || fase === "gerando";

  // Qualquer alteração depois de uma falha invalida o envio parcial.
  function alterou() {
    sessao.current = null;
    if (fase === "erro") setFase("preenchendo");
  }

  function adicionar(tipo: TipoImagem) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const selecionados = Array.from(e.target.files ?? []);
      e.target.value = ""; // permite escolher o mesmo arquivo de novo
      const avisos: string[] = [];
      const validos = selecionados.filter((f) => {
        if (f.type && !f.type.startsWith("image/")) {
          avisos.push(`"${f.name}" não é uma imagem.`);
          return false;
        }
        if (f.size > MAX_BYTES_ARQUIVO) {
          avisos.push(`"${f.name}" passa de 50 MB.`);
          return false;
        }
        return true;
      });
      const atuais = tipo === "FORMULARIO" ? formularios : pecas;
      const limite = tipo === "FORMULARIO" ? MAX_FOLHAS_FORMULARIO : MAX_FOTOS_PECAS;
      const cabem = validos.slice(0, Math.max(0, limite - atuais.length));
      if (cabem.length < validos.length) avisos.push(`Limite de ${limite} fotos atingido.`);
      const novos = cabem.map((arquivo) => ({ id: `a${++contadorAnexos}`, arquivo, miniatura: URL.createObjectURL(arquivo) }));
      (tipo === "FORMULARIO" ? setFormularios : setPecas)((lista) => [...lista, ...novos]);
      setAviso(avisos.join(" "));
      if (novos.length) alterou();
    };
  }

  function remover(tipo: TipoImagem) {
    return (id: string) => {
      const setter = tipo === "FORMULARIO" ? setFormularios : setPecas;
      setter((atuais) => {
        const alvo = atuais.find((a) => a.id === id);
        if (alvo) URL.revokeObjectURL(alvo.miniatura);
        reduzidas.current.delete(id);
        return atuais.filter((a) => a.id !== id);
      });
      alterou();
    };
  }

  const faltando: string[] = [];
  if (!opValida(op)) faltando.push("número da OP (4 a 8 dígitos)");
  if (formularios.length === 0) faltando.push("foto do formulário");
  if (pecas.length === 0) faltando.push("fotos das peças");
  const podeEnviar = faltando.length === 0 && !ocupado;

  async function enviar() {
    if (!podeEnviar) return;
    setFase("enviando");
    setMensagemErro("");
    setAviso("");
    setEtapa("Preparando envio…");

    const itens = [
      ...formularios.map((a, i) => ({ tipo: "FORMULARIO" as const, ordem: i + 1, anexo: a })),
      ...pecas.map((a, i) => ({ tipo: "PECA" as const, ordem: i + 1, anexo: a })),
    ];
    const chave = (i: { tipo: TipoImagem; ordem: number }) => `${i.tipo}-${i.ordem}`;
    // Cada foto pesa igual na barra: 10% reduzir no celular, 90% enviar. O PDF fecha os últimos 10%.
    const avanco = new Map<string, number>();
    const atualizar = () => {
      const soma = itens.reduce((t, i) => t + (avanco.get(chave(i)) ?? 0), 0);
      setProgresso((soma / itens.length) * 0.9);
    };

    try {
      if (sessao.current && Date.now() - sessao.current.criadaEm > VALIDADE_SESSAO_MS) sessao.current = null;
      if (!sessao.current) {
        const r = await postJson<{ id: string; envios: { tipo: TipoImagem; ordem: number; url: string }[] }>("/api/laudos", {
          numeroOP: op,
          observacoes,
          arquivos: itens.map(({ tipo, ordem }) => ({ tipo, ordem })),
        });
        sessao.current = {
          laudoId: r.id,
          urls: new Map(r.envios.map((e) => [chave(e), e.url])),
          concluidas: new Set(),
          criadaEm: Date.now(),
        };
      }
      const s = sessao.current;
      for (const k of s.concluidas) avanco.set(k, 1);
      atualizar();

      const atualizarEtapa = () => setEtapa(`Enviando fotos: ${s.concluidas.size} de ${itens.length} prontas`);
      atualizarEtapa();

      await emParalelo(itens, ENVIOS_SIMULTANEOS, async (item) => {
        const k = chave(item);
        if (s.concluidas.has(k)) return;
        let reduzida = reduzidas.current.get(item.anexo.id);
        if (!reduzida) {
          reduzida = await reduzirFoto(item.anexo.arquivo, item.tipo);
          reduzidas.current.set(item.anexo.id, reduzida);
        }
        avanco.set(k, 0.1);
        atualizar();
        await enviarArquivo(s.urls.get(k)!, reduzida, item.anexo.arquivo.name, (f) => {
          avanco.set(k, 0.1 + f * 0.9);
          atualizar();
        });
        s.concluidas.add(k);
        avanco.set(k, 1);
        atualizar();
        atualizarEtapa();
      });

      setFase("gerando");
      setEtapa("Processando as fotos e montando o PDF…");
      await postJson(`/api/laudos/${s.laudoId}/pdf`, { formularios: formularios.length, pecas: pecas.length });
      setProgresso(1);
      router.push(`/laudos/${s.laudoId}`);
    } catch (e) {
      setMensagemErro(e instanceof Error ? e.message : String(e));
      setFase("erro");
    }
  }

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <section className="bloco">
        <label htmlFor="op">
          <h2>Número da OP</h2>
        </label>
        <input
          id="op"
          className="campo-op"
          type="text"
          inputMode="numeric"
          pattern="\d{4,8}"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={8}
          placeholder="Ex.: 123456"
          value={op}
          disabled={ocupado}
          onChange={(e) => {
            setOp(e.target.value.replace(/\D/g, "").slice(0, 8));
            alterou();
          }}
        />
        {op.length > 0 && !opValida(op) && <p className="ajuda alerta">A OP tem de 4 a 8 dígitos.</p>}
      </section>

      <BlocoFotos
        titulo={`Formulário ${CODIGO_FORMULARIO}`}
        instrucao="Fotografe o formulário preenchido. Se usou frente e verso, tire uma foto de cada lado."
        rotuloBotao="Fotografar formulário"
        anexos={formularios}
        contador={formularios.length ? `${plural(formularios.length, "folha do formulário anexada", "folhas do formulário anexadas")}` : "Nenhuma foto do formulário"}
        aoAdicionar={adicionar("FORMULARIO")}
        aoRemover={remover("FORMULARIO")}
        desabilitado={ocupado}
      />

      <BlocoFotos
        titulo="Peças acabadas"
        instrucao="Fotografe as peças. Toque de novo no botão para adicionar mais fotos."
        rotuloBotao="Fotografar peças"
        anexos={pecas}
        contador={pecas.length ? plural(pecas.length, "foto das peças anexada", "fotos das peças anexadas") : "Nenhuma foto das peças"}
        aoAdicionar={adicionar("PECA")}
        aoRemover={remover("PECA")}
        desabilitado={ocupado}
      />

      <section className="bloco">
        <label htmlFor="obs">
          <h2>
            Observações <span className="opcional">(opcional)</span>
          </h2>
        </label>
        <textarea
          id="obs"
          rows={4}
          maxLength={MAX_OBSERVACOES}
          value={observacoes}
          disabled={ocupado}
          onChange={(e) => {
            setObservacoes(e.target.value);
            alterou();
          }}
        />
      </section>

      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      <div className="barra-envio">
        {ocupado || fase === "erro" ? (
          <div className="progresso" role="status" aria-live="polite">
            <div
              className={`trilho${fase === "gerando" ? " animado" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progresso * 100)}
            >
              <div className="preenchimento" style={{ width: `${Math.round(progresso * 100)}%` }} />
            </div>
            <p>
              {fase === "erro" ? (
                <span className="alerta">{mensagemErro}</span>
              ) : (
                <>
                  {etapa} <strong>{Math.round(progresso * 100)}%</strong>
                </>
              )}
            </p>
          </div>
        ) : (
          faltando.length > 0 && <p className="faltando">Falta: {faltando.join(", ")}.</p>
        )}
        <button type="submit" className="botao-enviar" disabled={!podeEnviar}>
          {fase === "erro" ? "Tentar novamente" : ocupado ? "Enviando…" : "Gerar laudo"}
        </button>
      </div>
    </form>
  );
}
