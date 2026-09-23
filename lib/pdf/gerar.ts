import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { LaudoPdf, type DadosLaudoPdf } from "./LaudoPdf";

export type { DadosLaudoPdf, ImagemPdf } from "./LaudoPdf";

export async function gerarPdfLaudo(dados: DadosLaudoPdf): Promise<Buffer> {
  // LaudoPdf devolve um <Document>; o cast só informa isso ao tipo de renderToBuffer.
  const documento = createElement(LaudoPdf, { dados }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(documento);
}
