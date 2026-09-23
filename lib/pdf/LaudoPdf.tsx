import { Circle, Document, Image, Line, Page, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { alocarFotos, contain } from "../layout";
import { MARCA, SIMBOLO } from "../marca";
import { CODIGO_FORMULARIO } from "../regras";
import { formatarDataHora } from "./formato";
import {
  ALTURA_CABECALHO,
  ALTURA_RODAPE,
  ALTURA_TITULO_FORMULARIO,
  AREA_FOTOS,
  caixaFormulario,
  DISTANCIA_RODAPE,
  ESPACO_APOS_CABECALHO,
  MARGEM,
  MARGEM_FORMULARIO,
} from "./medidas";

export interface ImagemPdf {
  id: string;
  dados: Buffer;
  largura: number;
  altura: number;
}

export interface DadosLaudoPdf {
  numeroOP: string;
  observacoes: string | null;
  emitidoEm: Date;
  /** Folhas do formulário de inspeção, na ordem. */
  formularios: ImagemPdf[];
  /** Fotos das peças acabadas, na ordem de envio. */
  pecas: ImagemPdf[];
}

const C = MARCA.cores;
const ALTURA_FAIXA_CAPA = 96;

const s = StyleSheet.create({
  pagina: { fontFamily: "Helvetica", fontSize: 10, color: C.cinzaEscuro },
  rodape: {
    position: "absolute",
    left: MARGEM,
    right: MARGEM,
    bottom: DISTANCIA_RODAPE,
    height: ALTURA_RODAPE,
    paddingTop: 5,
    borderTop: `0.75 solid ${C.cinzaClaro}`,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: C.cinza,
  },
  rodapeMarca: { fontFamily: "Helvetica-Bold", color: C.azulEscuro, letterSpacing: 0.8 },
  nomeMarca: { fontFamily: "Helvetica-Bold", letterSpacing: 1.6 },
  // Página 1
  faixa: {
    height: ALTURA_FAIXA_CAPA,
    backgroundColor: C.azul,
    paddingHorizontal: MARGEM,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  faixaTitulo: { color: "#ffffff", fontSize: 9, letterSpacing: 1.4, textAlign: "right", fontFamily: "Helvetica-Bold" },
  faixaSub: { color: "#dcefff", fontSize: 8, textAlign: "right", marginTop: 3 },
  faixaFina: { height: 5, backgroundColor: C.marinho },
  corpoCapa: { paddingHorizontal: MARGEM, paddingTop: 30 },
  rotulo: { fontSize: 8, letterSpacing: 1.5, color: C.cinza, fontFamily: "Helvetica-Bold" },
  caixaOP: {
    flexDirection: "row",
    backgroundColor: "#EEF4F9",
    borderLeft: `5 solid ${C.azul}`,
    paddingVertical: 18,
    paddingHorizontal: 20,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  numeroOP: { fontSize: 40, fontFamily: "Helvetica-Bold", color: C.marinho, marginTop: 6 },
  emissaoValor: { fontSize: 11, color: C.marinho, marginTop: 4, textAlign: "right" },
  secao: { marginTop: 26 },
  tituloSecao: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.azulEscuro,
    letterSpacing: 1.2,
    paddingBottom: 5,
    marginBottom: 10,
    borderBottom: `1 solid ${C.cinzaClaro}`,
  },
  tabelaLinha: { flexDirection: "row", paddingVertical: 6, borderBottom: `0.5 solid ${C.cinzaClaro}` },
  tabelaRotulo: { width: 230, color: C.cinza, fontSize: 10 },
  tabelaValor: { fontFamily: "Helvetica-Bold", color: C.marinho, fontSize: 10 },
  observacoes: { fontSize: 10.5, lineHeight: 1.5, color: C.cinzaEscuro },
  // Páginas do formulário
  tituloFormulario: {
    height: ALTURA_TITULO_FORMULARIO,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  tituloFormularioTexto: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.marinho },
  // Páginas de fotos
  cabecalho: {
    height: ALTURA_CABECALHO,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: `1.5 solid ${C.azul}`,
    paddingBottom: 6,
    marginBottom: ESPACO_APOS_CABECALHO,
  },
  cabecalhoMarca: { flexDirection: "row", alignItems: "center" },
  cabecalhoNome: { fontSize: 10, color: C.marinho },
  cabecalhoSub: { fontSize: 7.5, color: C.cinza, marginTop: 2 },
  cabecalhoOP: { fontSize: 14, fontFamily: "Helvetica-Bold", color: C.marinho, textAlign: "right" },
  legenda: { position: "absolute", fontSize: 7.5, textAlign: "center", paddingTop: 3, color: C.cinza },
});

function Simbolo({ altura, cor = C.azul }: { altura: number; cor?: string }) {
  const { largura: w, altura: h, espessura, circulos, linhas } = SIMBOLO;
  return (
    <Svg viewBox={`0 0 ${w} ${h}`} width={(altura * w) / h} height={altura}>
      {circulos.map((c, i) => (
        <Circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} fill="none" stroke={cor} strokeWidth={espessura} />
      ))}
      {linhas.map((l, i) => (
        <Line key={`l${i}`} {...l} stroke={cor} strokeWidth={espessura} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

function Marca({ altura, cor, tamanhoNome }: { altura: number; cor: string; tamanhoNome: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Simbolo altura={altura} cor={cor} />
      <Text style={[s.nomeMarca, { color: cor, fontSize: tamanhoNome, marginLeft: altura * 0.35 }]}>{MARCA.nome}</Text>
    </View>
  );
}

function plural(n: number, singular: string, pluralTexto: string) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

function Rodape({ numeroOP }: { numeroOP: string }) {
  return (
    <View style={s.rodape} fixed>
      <Text>
        <Text style={s.rodapeMarca}>{MARCA.nome}</Text> · Laudo de Inspeção de Produção · OP {numeroOP}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function PaginaIdentificacao({ dados }: { dados: DadosLaudoPdf }) {
  const observacoes = dados.observacoes?.trim();
  return (
    <Page size="A4" style={[s.pagina, { paddingBottom: MARGEM + ALTURA_RODAPE }]}>
      <View style={s.faixa}>
        <Marca altura={40} cor="#ffffff" tamanhoNome={20} />
        <View>
          <Text style={s.faixaTitulo}>LAUDO DE INSPEÇÃO DE PRODUÇÃO</Text>
          <Text style={s.faixaSub}>Peças acabadas · Ref. {CODIGO_FORMULARIO}</Text>
        </View>
      </View>
      <View style={s.faixaFina} />

      <View style={s.corpoCapa}>
        <View style={s.caixaOP}>
          <View>
            <Text style={s.rotulo}>ORDEM DE PRODUÇÃO</Text>
            <Text style={s.numeroOP}>OP {dados.numeroOP}</Text>
          </View>
          <View>
            <Text style={[s.rotulo, { textAlign: "right" }]}>EMISSÃO</Text>
            <Text style={s.emissaoValor}>{formatarDataHora(dados.emitidoEm)}</Text>
          </View>
        </View>

        <View style={s.secao}>
          <Text style={s.tituloSecao}>CONTEÚDO DO LAUDO</Text>
          <View style={s.tabelaLinha}>
            <Text style={s.tabelaRotulo}>Formulário {CODIGO_FORMULARIO}</Text>
            <Text style={s.tabelaValor}>{plural(dados.formularios.length, "folha", "folhas")}</Text>
          </View>
          <View style={s.tabelaLinha}>
            <Text style={s.tabelaRotulo}>Registro fotográfico das peças</Text>
            <Text style={s.tabelaValor}>{plural(dados.pecas.length, "foto", "fotos")}</Text>
          </View>
        </View>

        {observacoes ? (
          <View style={s.secao}>
            <Text style={s.tituloSecao}>OBSERVAÇÕES</Text>
            <Text style={s.observacoes}>{observacoes}</Text>
          </View>
        ) : null}
      </View>

      <Rodape numeroOP={dados.numeroOP} />
    </Page>
  );
}

function PaginaFormulario({ imagem, folha, numeroOP }: { imagem: ImagemPdf; folha: number; numeroOP: string }) {
  // A orientação da página acompanha a da foto, para o formulário sair o maior possível.
  const paisagem = imagem.largura > imagem.altura;
  const { largura: caixaLargura, altura: caixaAltura } = caixaFormulario(paisagem);
  const r = contain(imagem.largura / imagem.altura, caixaLargura, caixaAltura);

  return (
    <Page size="A4" orientation={paisagem ? "landscape" : "portrait"} style={[s.pagina, { padding: MARGEM_FORMULARIO }]}>
      <View style={s.tituloFormulario}>
        <Text style={s.tituloFormularioTexto}>Formulário {CODIGO_FORMULARIO} — folha {folha}</Text>
        <Marca altura={13} cor={C.azul} tamanhoNome={8} />
      </View>
      <View style={{ width: caixaLargura, height: caixaAltura, alignItems: "center" }}>
        <Image src={{ data: imagem.dados, format: "jpg" }} style={{ width: r.largura, height: r.altura }} />
      </View>
      <Rodape numeroOP={numeroOP} />
    </Page>
  );
}

function PaginasFotos({ dados }: { dados: DadosLaudoPdf }) {
  const porId = new Map(dados.pecas.map((p) => [p.id, p]));
  const paginas = alocarFotos(dados.pecas, AREA_FOTOS);
  return (
    <>
      {paginas.map((pagina, i) => (
        <Page key={i} size="A4" style={[s.pagina, { padding: MARGEM }]}>
          <View style={s.cabecalho}>
            <View style={s.cabecalhoMarca}>
              <Simbolo altura={26} />
              <View style={{ marginLeft: 8 }}>
                <Text style={[s.nomeMarca, s.cabecalhoNome]}>{MARCA.nome}</Text>
                <Text style={s.cabecalhoSub}>Registro fotográfico das peças acabadas</Text>
              </View>
            </View>
            <View>
              <Text style={s.cabecalhoOP}>OP {dados.numeroOP}</Text>
              <Text style={[s.cabecalhoSub, { textAlign: "right" }]}>
                Fotos {pagina.fotos[0].numero}–{pagina.fotos.at(-1)!.numero} de {dados.pecas.length}
              </Text>
            </View>
          </View>
          <View style={{ position: "relative", width: AREA_FOTOS.largura, height: AREA_FOTOS.altura }}>
            {pagina.fotos.map((f) => (
              <View key={f.id}>
                <Image
                  src={{ data: porId.get(f.id)!.dados, format: "jpg" }}
                  style={{ position: "absolute", left: f.x, top: f.y, width: f.largura, height: f.altura }}
                />
                <Text
                  style={[s.legenda, { left: f.legenda.x, top: f.legenda.y, width: f.legenda.largura, height: f.legenda.altura }]}
                >
                  Foto {f.numero}
                </Text>
              </View>
            ))}
          </View>
          <Rodape numeroOP={dados.numeroOP} />
        </Page>
      ))}
    </>
  );
}

export function LaudoPdf({ dados }: { dados: DadosLaudoPdf }) {
  return (
    <Document
      title={`Laudo de Inspeção — OP ${dados.numeroOP}`}
      author="Vanderhulst"
      subject={`Laudo de Inspeção de Produção (${CODIGO_FORMULARIO})`}
      creator="Vanderhulst · Automação Laudo de Inspeção"
      producer="Vanderhulst · Automação Laudo de Inspeção"
      language="pt-BR"
    >
      <PaginaIdentificacao dados={dados} />
      {dados.formularios.map((img, i) => (
        <PaginaFormulario key={img.id} imagem={img} folha={i + 1} numeroOP={dados.numeroOP} />
      ))}
      <PaginasFotos dados={dados} />
    </Document>
  );
}
