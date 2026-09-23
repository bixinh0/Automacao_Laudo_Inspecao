import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { alocarFotos, contain } from "../layout";
import { formatarDataHora } from "./formato";
import {
  A4,
  ALTURA_CABECALHO,
  ALTURA_RODAPE,
  ALTURA_TITULO_FORMULARIO,
  AREA_FOTOS,
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
  /** Folhas do formulário FM PRO 001 01, na ordem. */
  formularios: ImagemPdf[];
  /** Fotos das peças acabadas, na ordem de envio. */
  pecas: ImagemPdf[];
}

const COR_TEXTO = "#1a1a1a";
const COR_SECUNDARIA = "#555555";
const COR_LINHA = "#c8c8c8";

const s = StyleSheet.create({
  pagina: { fontFamily: "Helvetica", fontSize: 10, color: COR_TEXTO },
  rodape: {
    position: "absolute",
    left: MARGEM,
    right: MARGEM,
    bottom: MARGEM - 12,
    height: ALTURA_RODAPE,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: 8,
    color: COR_SECUNDARIA,
  },
  // Página 1
  capa: { padding: MARGEM, paddingBottom: MARGEM + ALTURA_RODAPE },
  rotulo: { fontSize: 9, letterSpacing: 1.5, color: COR_SECUNDARIA, fontFamily: "Helvetica-Bold" },
  tituloCapa: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4 },
  referencia: { fontSize: 9, color: COR_SECUNDARIA, marginTop: 2 },
  caixaOP: { marginTop: 28, paddingVertical: 18, borderTop: `2 solid ${COR_TEXTO}`, borderBottom: `2 solid ${COR_TEXTO}` },
  numeroOP: { fontSize: 44, fontFamily: "Helvetica-Bold", marginTop: 4 },
  emissao: { fontSize: 11, marginTop: 8 },
  secao: { marginTop: 26 },
  tituloSecao: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8, paddingBottom: 4, borderBottom: `1 solid ${COR_LINHA}` },
  itemResumo: { fontSize: 11, marginBottom: 4 },
  observacoes: { fontSize: 11, lineHeight: 1.45 },
  // Páginas do formulário
  tituloFormulario: { fontSize: 11, fontFamily: "Helvetica-Bold", height: ALTURA_TITULO_FORMULARIO },
  // Páginas de fotos
  cabecalho: {
    height: ALTURA_CABECALHO,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: `1 solid ${COR_LINHA}`,
    marginBottom: 0,
  },
  cabecalhoOP: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  cabecalhoTitulo: { fontSize: 9, color: COR_SECUNDARIA, marginTop: 2 },
  legenda: { position: "absolute", fontSize: 8, textAlign: "center", paddingTop: 3, color: COR_SECUNDARIA },
});

function plural(n: number, singular: string, pluralTexto: string) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

function Rodape({ numeroOP }: { numeroOP: string }) {
  return (
    <View style={s.rodape} fixed>
      <Text>Laudo de Inspeção de Produção · OP {numeroOP}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function PaginaIdentificacao({ dados }: { dados: DadosLaudoPdf }) {
  const observacoes = dados.observacoes?.trim();
  return (
    <Page size="A4" style={[s.pagina, s.capa]}>
      <Text style={s.rotulo}>LAUDO DE INSPEÇÃO DE PRODUÇÃO</Text>
      <Text style={s.tituloCapa}>Peças acabadas</Text>
      <Text style={s.referencia}>Formulário de referência: FM PRO 001 01</Text>

      <View style={s.caixaOP}>
        <Text style={s.rotulo}>ORDEM DE PRODUÇÃO</Text>
        <Text style={s.numeroOP}>OP {dados.numeroOP}</Text>
        <Text style={s.emissao}>Emitido em {formatarDataHora(dados.emitidoEm)}</Text>
      </View>

      <View style={s.secao}>
        <Text style={s.tituloSecao}>Conteúdo</Text>
        <Text style={s.itemResumo}>
          • Formulário FM PRO 001 01: {plural(dados.formularios.length, "folha", "folhas")}
        </Text>
        <Text style={s.itemResumo}>• Registro fotográfico das peças: {plural(dados.pecas.length, "foto", "fotos")}</Text>
      </View>

      {observacoes ? (
        <View style={s.secao}>
          <Text style={s.tituloSecao}>Observações</Text>
          <Text style={s.observacoes}>{observacoes}</Text>
        </View>
      ) : null}

      <Rodape numeroOP={dados.numeroOP} />
    </Page>
  );
}

function PaginaFormulario({ imagem, folha, numeroOP }: { imagem: ImagemPdf; folha: number; numeroOP: string }) {
  // A orientação da página acompanha a da foto, para o formulário sair o maior possível.
  const paisagem = imagem.largura > imagem.altura;
  const larguraPagina = paisagem ? A4.altura : A4.largura;
  const alturaPagina = paisagem ? A4.largura : A4.altura;
  const caixaLargura = larguraPagina - 2 * MARGEM_FORMULARIO;
  const caixaAltura = alturaPagina - 2 * MARGEM_FORMULARIO - ALTURA_TITULO_FORMULARIO - ALTURA_RODAPE;
  const r = contain(imagem.largura / imagem.altura, caixaLargura, caixaAltura);

  return (
    <Page
      size="A4"
      orientation={paisagem ? "landscape" : "portrait"}
      style={[s.pagina, { padding: MARGEM_FORMULARIO }]}
    >
      <Text style={s.tituloFormulario}>Formulário FM PRO 001 01 — folha {folha}</Text>
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
            <View>
              <Text style={s.cabecalhoOP}>OP {dados.numeroOP}</Text>
              <Text style={s.cabecalhoTitulo}>Registro fotográfico das peças acabadas</Text>
            </View>
            <Text style={s.cabecalhoTitulo}>
              Fotos {pagina.fotos[0].numero}–{pagina.fotos.at(-1)!.numero} de {dados.pecas.length}
            </Text>
          </View>
          <View style={{ position: "relative", width: AREA_FOTOS.largura, height: AREA_FOTOS.altura }}>
            {pagina.fotos.map((f) => (
              <View key={f.id}>
                <Image
                  src={{ data: porId.get(f.id)!.dados, format: "jpg" }}
                  style={{ position: "absolute", left: f.x, top: f.y, width: f.largura, height: f.altura }}
                />
                <Text
                  style={[
                    s.legenda,
                    { left: f.legenda.x, top: f.legenda.y, width: f.legenda.largura, height: f.legenda.altura },
                  ]}
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
      subject="Laudo de Inspeção de Produção (FM PRO 001 01)"
      creator="Automação Laudo de Inspeção"
      producer="Automação Laudo de Inspeção"
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
