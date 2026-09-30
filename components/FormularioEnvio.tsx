"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CHAVE_RASCUNHO_LOCAL,
  emAndamento,
  gravarRascunhoLocal,
  lerRascunhoLocal,
  pendencias,
  progressoFoto,
  rotuloEstado,
  type EstadoFoto,
} from "@/lib/envio";
import { reduzirFoto } from "@/lib/reduzirFoto";
import {
  CODIGO_FORMULARIO,
  limiteFotos,
  MAX_BYTES_ARQUIVO,
  MAX_OBSERVACOES,
  opValida,
  TIPOS,
  type TipoImagem,
} from "@/lib/regras";

/**
 * Tela de envio. Cada foto sobe assim que é escolhida:
 *  1. com a OP informada, o laudo é criado como rascunho no banco;
 *  2. cada foto ganha uma vaga no rascunho e vai direto ao Storage (URL assinada);
 *  3. o servidor processa a foto e devolve a miniatura, mostrada no lugar da prévia local.
 * "Gerar laudo" só monta o PDF com as fotos que já estão no servidor.
 * OP, observações e o rascunho ficam no sessionStorage: recarregar a página retoma de onde parou.
 */

interface Foto {
  /** Identifica a foto na tela (a do servidor só existe depois da reserva). */
  chave: string;
  tipo: TipoImagem;
  estado: EstadoFoto;
  /** Fração já enviada do arquivo, durante "enviando". */
  fracao: number;
  id?: string;
  url?: string;
  /** Ausente nas fotos recuperadas do servidor depois de recarregar. */
  arquivo?: File;
  /** Prévia local (object URL) até a miniatura do servidor chegar. */
  previa?: string;
  miniatura?: string;
  erro?: string;
}

interface FotoServidor {
  id: string;
  tipo: TipoImagem;
  ordem: number;
  recebida: boolean;
  miniatura: string | null;
}

type EstadoRascunho =
  | { id: string; emitido: true }
  | { id: string; emitido: false; numeroOP: string; observacoes: string; fotos: FotoServidor[] };

type Fase = "preenchendo" | "gerando" | "erro";

const ENVIOS_SIMULTANEOS = 3;
const ESPERA_DIGITACAO_MS = 700;

let contadorFotos = 0;
const novaChave = () => `f${++contadorFotos}`;

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

class ErroHttp extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function pedir<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroHttp("Sem conexão com o servidor. Verifique a internet e tente de novo.", 0);
  }
  if (resposta.status === 204) return undefined as T;
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroHttp(dados.erro || `Falha no servidor (HTTP ${resposta.status}).`, resposta.status);
  return dados as T;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Envia o arquivo direto ao Storage pela URL assinada, informando o progresso. */
function enviarArquivo(
  url: string,
  arquivo: Blob,
  nome: string,
  aoIniciar: (xhr: XMLHttpRequest) => void,
  aoProgredir: (fracao: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`O servidor recusou a foto (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("A conexão caiu durante o envio."));
    xhr.onabort = () => reject(new Error("Envio cancelado."));
    const corpo = new FormData();
    corpo.append("cacheControl", "3600");
    corpo.append("", arquivo, nome);
    aoIniciar(xhr);
    xhr.send(corpo);
  });
}

function lerLocal() {
  try {
    return lerRascunhoLocal(sessionStorage.getItem(CHAVE_RASCUNHO_LOCAL));
  } catch {
    return null; // navegação privada ou armazenamento bloqueado: segue sem restaurar
  }
}

function gravarLocal(op: string, observacoes: string, rascunhoId: string | null) {
  try {
    if (!op && !observacoes && !rascunhoId) sessionStorage.removeItem(CHAVE_RASCUNHO_LOCAL);
    else sessionStorage.setItem(CHAVE_RASCUNHO_LOCAL, gravarRascunhoLocal({ op, observacoes, rascunhoId }));
  } catch {
    // sem armazenamento: a tela funciona, só não restaura ao recarregar
  }
}

function BlocoFotos({
  tipo,
  titulo,
  instrucao,
  rotuloBotao,
  fotos,
  opInformada,
  desabilitado,
  aoAdicionar,
  aoRemover,
  aoTentarDeNovo,
}: {
  tipo: TipoImagem;
  titulo: string;
  instrucao: string;
  rotuloBotao: string;
  fotos: Foto[];
  opInformada: boolean;
  desabilitado: boolean;
  aoAdicionar: (e: ChangeEvent<HTMLInputElement>) => void;
  aoRemover: (chave: string) => void;
  aoTentarDeNovo: (chave: string) => void;
}) {
  const prontas = fotos.filter((f) => f.estado === "pronta").length;
  const nome = tipo === "FORMULARIO" ? ["folha do formulário", "folhas do formulário"] : ["foto das peças", "fotos das peças"];
  const contador =
    fotos.length === 0
      ? tipo === "FORMULARIO"
        ? "Nenhuma foto do formulário"
        : "Nenhuma foto das peças"
      : prontas === fotos.length
        ? `${plural(prontas, nome[0], nome[1])} ${prontas === 1 ? "enviada" : "enviadas"}`
        : `${prontas} de ${plural(fotos.length, nome[0], nome[1])} ${fotos.length === 1 ? "enviada" : "enviadas"}`;
  const falhas = fotos.flatMap((f, i) => (f.estado === "erro" && f.erro ? [`Foto ${i + 1}: ${f.erro}`] : []));

  return (
    <section className={`bloco ${tipo === "FORMULARIO" ? "bloco-formulario" : "bloco-pecas"}`}>
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
          data-tipo={tipo}
        />
      </label>
      <p className={`contador${fotos.length && prontas === fotos.length ? " ok" : ""}`} aria-live="polite">
        {contador}
      </p>
      {fotos.length > 0 && (
        <ul className="miniaturas">
          {fotos.map((f, i) => {
            const src = f.miniatura ?? f.previa;
            const pct = Math.round(progressoFoto(f.estado, f.fracao) * 100);
            const rotulo = rotuloEstado(f.estado, f.fracao, opInformada);
            return (
              <li key={f.chave} className={`foto foto-${f.estado}`} data-estado={f.estado} title={f.erro ?? rotulo}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={`Foto ${i + 1}`}
                    decoding="async"
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  />
                ) : (
                  <span className="sem-previa" aria-hidden="true">
                    📷
                  </span>
                )}
                <span className="numero">{i + 1}</span>
                {f.estado === "pronta" ? (
                  <span className="selo-foto" aria-label={`Foto ${i + 1} enviada`}>
                    ✓
                  </span>
                ) : (
                  <div className="estado-foto">
                    {f.estado !== "erro" && (
                      <div
                        className="mini-trilho"
                        role="progressbar"
                        aria-label={`Envio da foto ${i + 1}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                      >
                        <div className="preenchimento" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <span>{rotulo}</span>
                  </div>
                )}
                {f.estado === "erro" && f.arquivo && !desabilitado && (
                  <button
                    type="button"
                    className="tentar"
                    onClick={() => aoTentarDeNovo(f.chave)}
                    aria-label={`Enviar a foto ${i + 1} de novo`}
                  >
                    ↻
                  </button>
                )}
                {f.estado !== "removendo" && !desabilitado && (
                  <button type="button" className="remover" onClick={() => aoRemover(f.chave)} aria-label={`Remover foto ${i + 1}`}>
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {falhas.length > 0 && (
        <ul className="falhas-foto" role="alert">
          {falhas.map((t) => (
            <li key={t}>{t}</li>
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
  const [rascunhoId, setRascunhoId] = useState<string | null>(null);
  const [fotos, setFotosTela] = useState<Foto[]>([]);
  const [restaurado, setRestaurado] = useState(false);
  const [fase, setFase] = useState<Fase>("preenchendo");
  const [mensagemErro, setMensagemErro] = useState("");
  const [aviso, setAviso] = useState("");

  // O trabalho assíncrono lê sempre o valor atual por estas referências.
  const fotosRef = useRef<Foto[]>([]);
  const opRef = useRef("");
  const obsRef = useRef("");
  const rascunhoRef = useRef<string | null>(null);
  const restauradoRef = useRef(false);
  const criandoRascunho = useRef<Promise<string | null> | null>(null);
  const sincronizado = useRef({ op: "", observacoes: "" });
  const reservando = useRef<Record<TipoImagem, boolean>>({ FORMULARIO: false, PECA: false });
  const ativos = useRef(0);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  // Fotos já reduzidas: numa nova tentativa não precisa reduzir de novo.
  const reduzidas = useRef(new Map<string, Blob>());
  opRef.current = op;
  obsRef.current = observacoes;

  const mudar = useCallback((f: (lista: Foto[]) => Foto[]) => {
    fotosRef.current = f(fotosRef.current);
    setFotosTela(fotosRef.current);
  }, []);
  const atualizar = useCallback(
    (chave: string, dados: Partial<Foto>) => mudar((l) => l.map((f) => (f.chave === chave ? { ...f, ...dados } : f))),
    [mudar],
  );
  const obter = (chave: string) => fotosRef.current.find((f) => f.chave === chave);
  // Foto ainda na tela e não sendo removida: o trabalho sobre ela continua.
  const viva = (chave: string) => {
    const f = obter(chave);
    return Boolean(f && f.estado !== "removendo");
  };

  function descartar(chave: string) {
    const f = obter(chave);
    if (f?.previa) URL.revokeObjectURL(f.previa);
    reduzidas.current.delete(chave);
    xhrs.current.delete(chave);
    mudar((l) => l.filter((x) => x.chave !== chave));
  }

  function definirRascunho(id: string | null) {
    rascunhoRef.current = id;
    setRascunhoId(id);
  }

  /** Cria o rascunho no banco (uma vez) assim que houver OP válida. */
  function garantirRascunho(): Promise<string | null> {
    if (rascunhoRef.current) return Promise.resolve(rascunhoRef.current);
    if (!opValida(opRef.current)) return Promise.resolve(null);
    if (!criandoRascunho.current) {
      const dados = { numeroOP: opRef.current, observacoes: obsRef.current };
      criandoRascunho.current = pedir<{ id: string }>("POST", "/api/laudos", dados)
        .then((r) => {
          sincronizado.current = { op: dados.numeroOP, observacoes: dados.observacoes };
          definirRascunho(r.id);
          return r.id;
        })
        .finally(() => {
          criandoRascunho.current = null;
        });
    }
    return criandoRascunho.current;
  }

  /** Leva OP e observações ao rascunho, se mudaram desde a última vez. */
  async function sincronizar() {
    const id = rascunhoRef.current;
    const atual = { op: opRef.current, observacoes: obsRef.current };
    if (!id || !opValida(atual.op)) return;
    if (atual.op === sincronizado.current.op && atual.observacoes === sincronizado.current.observacoes) return;
    try {
      await pedir("PATCH", `/api/laudos/${id}`, { numeroOP: atual.op, observacoes: atual.observacoes });
      sincronizado.current = atual;
    } catch {
      // Sem problema: a OP e as observações vão de novo ao gerar o laudo.
    }
  }

  /** Reserva no rascunho as fotos escolhidas de um tipo, na ordem da escolha. */
  async function reservar(tipo: TipoImagem, chaves: string[]) {
    reservando.current[tipo] = true;
    mudar((l) => l.map((f) => (chaves.includes(f.chave) ? { ...f, estado: "reservando" as const, erro: undefined } : f)));
    try {
      const id = await garantirRascunho();
      const pedidas = chaves.filter((c) => obter(c)?.estado === "reservando");
      if (!id) {
        mudar((l) => l.map((f) => (pedidas.includes(f.chave) ? { ...f, estado: "aguardando" as const } : f)));
        return;
      }
      if (!pedidas.length) return;
      const { envios } = await pedir<{ envios: { id: string; ordem: number; url: string }[] }>(
        "POST",
        `/api/laudos/${id}/imagens`,
        { tipo, quantidade: pedidas.length },
      );
      pedidas.forEach((chave, i) => {
        // Removida enquanto a vaga era reservada: libera a vaga no servidor.
        if (obter(chave)?.estado !== "reservando") pedir("DELETE", `/api/laudos/${id}/imagens/${envios[i].id}`).catch(() => {});
        else atualizar(chave, { estado: "fila", id: envios[i].id, url: envios[i].url });
      });
    } catch (e) {
      mudar((l) =>
        l.map((f) => (chaves.includes(f.chave) && f.estado === "reservando" ? { ...f, estado: "erro" as const, erro: mensagem(e) } : f)),
      );
    } finally {
      reservando.current[tipo] = false;
      avancar();
    }
  }

  async function enviarFoto(chave: string) {
    ativos.current++;
    try {
      const foto = obter(chave)!;
      const id = rascunhoRef.current!;
      atualizar(chave, { estado: "reduzindo", fracao: 0, erro: undefined });
      let arquivo = reduzidas.current.get(chave);
      if (!arquivo) {
        arquivo = await reduzirFoto(foto.arquivo!, foto.tipo);
        reduzidas.current.set(chave, arquivo);
      }
      if (!viva(chave)) return;
      atualizar(chave, { estado: "enviando" });
      await enviarArquivo(
        foto.url!,
        arquivo,
        foto.arquivo!.name,
        (xhr) => xhrs.current.set(chave, xhr),
        (fracao) => viva(chave) && atualizar(chave, { fracao }),
      );
      xhrs.current.delete(chave);
      if (!viva(chave)) return;
      atualizar(chave, { estado: "processando" });
      const r = await pedir<FotoServidor>("POST", `/api/laudos/${id}/imagens/${foto.id}`);
      if (!viva(chave)) return;
      const atual = obter(chave);
      if (atual?.previa) URL.revokeObjectURL(atual.previa);
      reduzidas.current.delete(chave);
      atualizar(chave, { estado: "pronta", miniatura: r.miniatura ?? undefined, previa: undefined, arquivo: undefined });
    } catch (e) {
      if (viva(chave)) atualizar(chave, { estado: "erro", erro: mensagem(e) });
    } finally {
      xhrs.current.delete(chave);
      ativos.current--;
      avancar();
    }
  }

  /** Dá o próximo passo possível em cada foto: reservar vaga e enviar, poucas por vez. */
  function avancar() {
    if (!restauradoRef.current) return;
    if (rascunhoRef.current || opValida(opRef.current)) {
      for (const tipo of TIPOS) {
        if (reservando.current[tipo]) continue; // as novas entram quando esta reserva terminar
        const esperando = fotosRef.current.filter((f) => f.tipo === tipo && f.estado === "aguardando");
        if (esperando.length) reservar(tipo, esperando.map((f) => f.chave));
      }
    }
    while (ativos.current < ENVIOS_SIMULTANEOS) {
      const proxima = fotosRef.current.find((f) => f.estado === "fila");
      if (!proxima) break;
      enviarFoto(proxima.chave);
    }
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
      const limite = limiteFotos(tipo);
      const atuais = fotosRef.current.filter((f) => f.tipo === tipo).length;
      const cabem = validos.slice(0, Math.max(0, limite - atuais));
      if (cabem.length < validos.length) avisos.push(`Limite de ${limite} fotos atingido.`);
      if (!opValida(opRef.current) && !rascunhoRef.current && cabem.length) {
        avisos.push("As fotos serão enviadas assim que o número da OP for informado.");
      }
      const novas: Foto[] = cabem.map((arquivo) => ({
        chave: novaChave(),
        tipo,
        estado: "aguardando",
        fracao: 0,
        arquivo,
        previa: URL.createObjectURL(arquivo),
      }));
      mudar((l) => [...l, ...novas]);
      setAviso(avisos.join(" "));
      if (fase === "erro") setFase("preenchendo");
      avancar();
    };
  }

  async function remover(chave: string) {
    const foto = obter(chave);
    if (!foto) return;
    const anterior = foto.estado;
    xhrs.current.get(chave)?.abort();
    const id = rascunhoRef.current;
    // Sem vaga no servidor (ainda esperando ou reservando): basta tirar da tela.
    if (!foto.id || !id) return descartar(chave);
    atualizar(chave, { estado: "removendo" });
    try {
      await pedir("DELETE", `/api/laudos/${id}/imagens/${foto.id}`);
      descartar(chave);
      if (fase === "erro") setFase("preenchendo");
    } catch (e) {
      atualizar(chave, {
        estado: anterior === "pronta" ? "pronta" : "erro",
        erro: anterior === "pronta" ? undefined : "Envio interrompido.",
      });
      setAviso(`Não foi possível remover a foto: ${mensagem(e)}`);
    }
  }

  function tentarDeNovo(chave: string) {
    const f = obter(chave);
    if (!f?.arquivo) return;
    atualizar(chave, { estado: f.id && f.url ? "fila" : "aguardando", erro: undefined, fracao: 0 });
    avancar();
  }

  // Ao abrir: restaura OP e observações e, se havia rascunho, as fotos já enviadas.
  useEffect(() => {
    const local = lerLocal();
    if (local) {
      opRef.current = local.op;
      obsRef.current = local.observacoes;
      setOp(local.op);
      setObservacoes(local.observacoes);
    }
    let cancelado = false;
    (async () => {
      if (local?.rascunhoId) {
        try {
          const r = await pedir<EstadoRascunho>("GET", `/api/laudos/${local.rascunhoId}`);
          if (cancelado) return;
          if (r.emitido) {
            // O laudo foi gerado, mas a resposta não chegou antes de recarregar.
            gravarLocal("", "", null);
            router.replace(`/laudos/${r.id}`);
            return;
          }
          definirRascunho(r.id);
          sincronizado.current = { op: r.numeroOP, observacoes: r.observacoes };
          const recuperadas: Foto[] = r.fotos.map((f) => ({
            chave: novaChave(),
            tipo: f.tipo,
            id: f.id,
            estado: f.recebida ? "pronta" : "processando",
            fracao: 1,
            miniatura: f.miniatura ?? undefined,
          }));
          mudar(() => recuperadas);
          // Envios interrompidos pelo recarregamento: se o arquivo chegou, o servidor processa; senão, sai da lista.
          const interrompidas = recuperadas.filter((f) => f.estado === "processando");
          const descartadas = await Promise.all(
            interrompidas.map(async (f) => {
              try {
                const p = await pedir<FotoServidor>("POST", `/api/laudos/${r.id}/imagens/${f.id}`);
                atualizar(f.chave, { estado: "pronta", miniatura: p.miniatura ?? undefined });
                return 0;
              } catch {
                await pedir("DELETE", `/api/laudos/${r.id}/imagens/${f.id}`).catch(() => {});
                descartar(f.chave);
                return 1;
              }
            }),
          );
          const n = descartadas.reduce((a: number, b) => a + b, 0);
          if (n) setAviso(`${plural(n, "foto não terminou", "fotos não terminaram")} de subir antes de recarregar. Escolha de novo.`);
        } catch (e) {
          if (cancelado) return;
          if (e instanceof ErroHttp && (e.status === 404 || e.status === 409)) {
            setAviso("O rascunho anterior não existe mais (rascunhos expiram em 1 dia). Envie as fotos de novo.");
          } else {
            // Mantém o vínculo: recarregar de novo, com conexão, recupera as fotos.
            definirRascunho(local.rascunhoId);
            setAviso(`Não foi possível recuperar as fotos já enviadas: ${mensagem(e)} Recarregue a página.`);
          }
        }
      }
      if (cancelado) return;
      restauradoRef.current = true;
      setRestaurado(true);
      avancar();
    })();
    return () => {
      cancelado = true;
    };
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda OP, observações e o rascunho a cada mudança (depois de restaurar, para não apagar o que havia).
  useEffect(() => {
    if (restaurado) gravarLocal(op, observacoes, rascunhoId);
  }, [op, observacoes, rascunhoId, restaurado]);

  // Com a OP informada (e a pessoa parou de digitar), cria o rascunho ou atualiza o existente.
  useEffect(() => {
    if (!restaurado || fase === "gerando") return;
    const t = setTimeout(() => {
      if (rascunhoRef.current) sincronizar();
      else if (opValida(op))
        garantirRascunho()
          .then(avancar)
          .catch((e) => setAviso(`Não foi possível criar o rascunho: ${mensagem(e)}`));
    }, ESPERA_DIGITACAO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, observacoes, restaurado]);

  // Avisa antes de sair com fotos subindo ou o PDF sendo gerado.
  const ocupado = fase === "gerando";
  const subindo = fotos.some((f) => emAndamento(f.estado) && f.estado !== "aguardando");
  useEffect(() => {
    if (!subindo && !ocupado) return;
    const aoSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [subindo, ocupado]);

  // Libera a memória das prévias ao sair da tela.
  useEffect(
    () => () => {
      for (const f of fotosRef.current) if (f.previa) URL.revokeObjectURL(f.previa);
      for (const x of xhrs.current.values()) x.abort();
    },
    [],
  );

  const formularios = fotos.filter((f) => f.tipo === "FORMULARIO");
  const pecas = fotos.filter((f) => f.tipo === "PECA");
  const faltando = pendencias(op, fotos);
  const podeGerar = restaurado && faltando.length === 0 && !ocupado && Boolean(rascunhoId);
  const bloqueado = !restaurado || ocupado;

  async function gerar() {
    const id = rascunhoRef.current;
    if (!podeGerar || !id) return;
    setFase("gerando");
    setMensagemErro("");
    setAviso("");
    try {
      await pedir("POST", `/api/laudos/${id}/pdf`, {
        numeroOP: op,
        observacoes,
        imagens: [...formularios, ...pecas].map((f) => f.id),
      });
      gravarLocal("", "", null);
      router.push(`/laudos/${id}`);
    } catch (e) {
      setMensagemErro(mensagem(e));
      setFase("erro");
    }
  }

  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        gerar();
      }}
    >
      <div className="coluna-dados">
        <section className="bloco bloco-op">
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
            disabled={bloqueado}
            onChange={(e) => {
              setOp(e.target.value.replace(/\D/g, "").slice(0, 8));
              if (fase === "erro") setFase("preenchendo");
            }}
            onBlur={() => {
              if (rascunhoRef.current) sincronizar();
              else if (opValida(op)) garantirRascunho().then(avancar).catch(() => {});
            }}
          />
          {op.length > 0 && !opValida(op) && <p className="ajuda alerta">A OP tem de 4 a 8 dígitos.</p>}
          {rascunhoId && opValida(op) && <p className="ajuda rascunho-salvo">Rascunho salvo. As fotos sobem assim que escolhidas.</p>}
        </section>

        <section className="bloco bloco-obs">
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
            disabled={bloqueado}
            onChange={(e) => {
              setObservacoes(e.target.value);
              if (fase === "erro") setFase("preenchendo");
            }}
            onBlur={() => sincronizar()}
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
              {ocupado && (
                <div className="trilho animado" role="progressbar" aria-label="Gerando o PDF">
                  <div className="preenchimento" style={{ width: "100%" }} />
                </div>
              )}
              <p>{fase === "erro" ? <span className="alerta">{mensagemErro}</span> : "Montando o PDF do laudo…"}</p>
            </div>
          ) : (
            faltando.length > 0 && <p className="faltando">Falta: {faltando.join(", ")}.</p>
          )}
          <button type="submit" className="botao-enviar" disabled={!podeGerar}>
            {fase === "erro" ? "Tentar novamente" : ocupado ? "Gerando…" : "Gerar laudo"}
          </button>
        </div>
      </div>

      <div className="coluna-fotos">
        <BlocoFotos
          tipo="FORMULARIO"
          titulo={`Formulário ${CODIGO_FORMULARIO}`}
          instrucao="Fotografe o formulário preenchido. Se usou frente e verso, tire uma foto de cada lado."
          rotuloBotao="Fotografar formulário"
          fotos={formularios}
          opInformada={opValida(op) || Boolean(rascunhoId)}
          desabilitado={bloqueado}
          aoAdicionar={adicionar("FORMULARIO")}
          aoRemover={remover}
          aoTentarDeNovo={tentarDeNovo}
        />
        <BlocoFotos
          tipo="PECA"
          titulo="Peças acabadas"
          instrucao="Fotografe as peças. Toque de novo no botão para adicionar mais fotos."
          rotuloBotao="Fotografar peças"
          fotos={pecas}
          opInformada={opValida(op) || Boolean(rascunhoId)}
          desabilitado={bloqueado}
          aoAdicionar={adicionar("PECA")}
          aoRemover={remover}
          aoTentarDeNovo={tentarDeNovo}
        />
      </div>
    </form>
  );
}
