/**
 * Alocação procedural das fotos das peças nas páginas do laudo.
 *
 * Função pura: recebe as dimensões das fotos e da área útil da página e
 * devolve, para cada página, a posição e o tamanho exatos de cada foto e de
 * sua legenda. Não depende de React nem do gerador de PDF, o que permite
 * testar todas as regras isoladamente (ver lib/layout.test.ts).
 *
 * Regras (por página, conforme a quantidade de fotos nela):
 *   1       → uma imagem na largura útil, altura máxima de meia página
 *   2       → duas lado a lado, mesma altura
 *   3       → 2 na primeira linha, 1 centralizada abaixo
 *   4       → grade 2 × 2
 *   5 ou 6  → grade 3 × 2 (3 linhas × 2 colunas)
 *   7 a 9   → grade 3 × 3; o excedente vai para as páginas seguintes
 *
 * - Enquadramento "contain": a proporção é sempre preservada, nada é cortado.
 * - Fotos de mesma orientação são agrupadas na mesma linha sempre que possível.
 * - A última página nunca fica com uma única foto órfã: se sobrar uma, a
 *   página anterior cede uma foto (fica com 8) e a última fica com 2.
 * - A numeração (Foto 1, Foto 2…) segue a ordem de leitura final.
 */

export interface FotoEntrada {
  id: string;
  largura: number;
  altura: number;
}

export interface Area {
  largura: number;
  altura: number;
}

export interface FotoPosicionada {
  id: string;
  /** Número sequencial global, na ordem de leitura (Foto 1, Foto 2…). */
  numero: number;
  /** Retângulo da imagem, relativo ao canto superior esquerdo da área útil. */
  x: number;
  y: number;
  largura: number;
  altura: number;
  /** Retângulo da legenda, logo abaixo da imagem. */
  legenda: { x: number; y: number; largura: number; altura: number };
}

export interface PaginaFotos {
  fotos: FotoPosicionada[];
}

export interface OpcoesLayout {
  /** Espaço horizontal entre fotos de uma mesma linha. */
  espacoHorizontal: number;
  /** Espaço vertical entre uma linha (incluindo legenda) e a seguinte. */
  espacoVertical: number;
  /** Altura reservada para a legenda abaixo de cada linha de fotos. */
  alturaLegenda: number;
}

export const OPCOES_PADRAO: OpcoesLayout = {
  espacoHorizontal: 10,
  espacoVertical: 10,
  alturaLegenda: 14,
};

export const MAX_FOTOS_POR_PAGINA = 9;

type Orientacao = "paisagem" | "retrato";

function proporcao(f: FotoEntrada): number {
  return f.largura / f.altura;
}

function orientacao(f: FotoEntrada): Orientacao {
  return f.largura >= f.altura ? "paisagem" : "retrato";
}

/**
 * Quantas fotos vão em cada página. Enche páginas de 9 e, se a última
 * ficar com uma só, redistribui: a penúltima cede uma foto.
 */
export function distribuirPaginas(total: number): number[] {
  if (total <= 0) return [];
  const paginas: number[] = [];
  let restantes = total;
  while (restantes > MAX_FOTOS_POR_PAGINA) {
    paginas.push(MAX_FOTOS_POR_PAGINA);
    restantes -= MAX_FOTOS_POR_PAGINA;
  }
  paginas.push(restantes);
  if (paginas.length > 1 && restantes === 1) {
    paginas[paginas.length - 2] -= 1;
    paginas[paginas.length - 1] += 1;
  }
  return paginas;
}

/** Quantas fotos em cada linha da página, conforme a tabela de disposição. */
export function estruturaLinhas(quantidade: number): number[] {
  switch (quantidade) {
    case 1:
      return [1];
    case 2:
      return [2];
    case 3:
      return [2, 1];
    case 4:
      return [2, 2];
    case 5:
      return [2, 2, 1];
    case 6:
      return [2, 2, 2];
    case 7:
      return [3, 3, 1];
    case 8:
      return [3, 3, 2];
    case 9:
      return [3, 3, 3];
    default:
      throw new Error(`Quantidade de fotos por página inválida: ${quantidade}`);
  }
}

/**
 * Distribui as fotos da página nas linhas, agrupando as de mesma orientação.
 * Testa colocar primeiro as paisagens ou primeiro os retratos (mantendo a
 * ordem original dentro de cada grupo) e fica com a opção que gera menos
 * linhas mistas. No empate, começa pelo grupo da primeira foto enviada.
 */
export function agruparPorOrientacao(fotos: FotoEntrada[], linhas: number[]): FotoEntrada[][] {
  return melhorAgrupamento(fotos, linhas).linhas;
}

function contarMistas(linhas: FotoEntrada[][]) {
  return linhas.filter((l) => new Set(l.map(orientacao)).size > 1).length;
}

function melhorAgrupamento(fotos: FotoEntrada[], linhas: number[]) {
  const paisagens = fotos.filter((f) => orientacao(f) === "paisagem");
  const retratos = fotos.filter((f) => orientacao(f) === "retrato");
  const primeiroGrupo = fotos.length > 0 ? orientacao(fotos[0]) : "paisagem";

  const candidatos =
    primeiroGrupo === "paisagem"
      ? [[...paisagens, ...retratos], [...retratos, ...paisagens]]
      : [[...retratos, ...paisagens], [...paisagens, ...retratos]];

  let melhor = { linhas: [] as FotoEntrada[][], mistas: Infinity };
  for (const ordem of candidatos) {
    const distribuicao = fatiar(ordem, linhas);
    const mistas = contarMistas(distribuicao);
    if (mistas < melhor.mistas) melhor = { linhas: distribuicao, mistas };
  }
  return melhor;
}

/**
 * Estruturas de linha equivalentes à da tabela: mesmo número de linhas e de
 * colunas, linhas incompletas no fim. Ex.: 7 fotos → [3,3,1] ou [3,2,2].
 * A da tabela vem primeiro e só perde se outra gerar menos linhas mistas.
 */
export function estruturasAlternativas(quantidade: number): number[][] {
  const padrao = estruturaLinhas(quantidade);
  const colunas = Math.max(...padrao);
  const resultado: number[][] = [padrao];
  const gerar = (restantes: number, linhas: number, maximo: number, atual: number[]) => {
    if (linhas === 0) {
      if (restantes === 0 && atual.join() !== padrao.join()) resultado.push([...atual]);
      return;
    }
    for (let n = Math.min(maximo, restantes); n >= 1; n--) gerar(restantes - n, linhas - 1, n, [...atual, n]);
  };
  gerar(quantidade, padrao.length, colunas, []);
  return resultado.filter((e) => e[0] === colunas);
}

function distribuirEmLinhas(fotos: FotoEntrada[]): FotoEntrada[][] {
  let melhor = { linhas: [] as FotoEntrada[][], mistas: Infinity };
  for (const estrutura of estruturasAlternativas(fotos.length)) {
    const candidato = melhorAgrupamento(fotos, estrutura);
    if (candidato.mistas < melhor.mistas) melhor = candidato;
  }
  return melhor.linhas;
}

function fatiar<T>(itens: T[], tamanhos: number[]): T[][] {
  const resultado: T[][] = [];
  let inicio = 0;
  for (const t of tamanhos) {
    resultado.push(itens.slice(inicio, inicio + t));
    inicio += t;
  }
  return resultado;
}

/**
 * Reparte a altura disponível entre as linhas ("enchimento por nível"):
 * linhas que precisam de pouca altura (fotos deitadas) recebem só o que
 * precisam, e a sobra vai para as que precisam de mais (fotos em pé).
 */
export function repartirAltura(demandas: number[], disponivel: number): number[] {
  const soma = demandas.reduce((a, b) => a + b, 0);
  if (soma <= disponivel) return [...demandas];

  const ordenadas = [...demandas].sort((a, b) => a - b);
  let restante = disponivel;
  let nivel = 0;
  for (let i = 0; i < ordenadas.length; i++) {
    const linhasRestantes = ordenadas.length - i;
    const nivelUniforme = restante / linhasRestantes;
    if (ordenadas[i] >= nivelUniforme) {
      nivel = nivelUniforme;
      break;
    }
    restante -= ordenadas[i];
    nivel = ordenadas[i];
  }
  return demandas.map((d) => Math.min(d, nivel));
}

/** Maior retângulo com a proporção dada que cabe na caixa (enquadramento contain). */
export function contain(prop: number, caixaLargura: number, caixaAltura: number) {
  let largura = caixaLargura;
  let altura = largura / prop;
  if (altura > caixaAltura) {
    altura = caixaAltura;
    largura = altura * prop;
  }
  return { largura, altura };
}

interface FotoLocal {
  foto: FotoEntrada;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Posiciona as fotos de uma única página (1 a 9 fotos). */
export function posicionarPagina(fotos: FotoEntrada[], area: Area, opcoes: OpcoesLayout = OPCOES_PADRAO): FotoLocal[] {
  const n = fotos.length;
  const { espacoHorizontal: gH, espacoVertical: gV, alturaLegenda: hL } = opcoes;

  if (n === 1) {
    const caixaAltura = Math.min(area.altura / 2, area.altura - hL);
    const r = contain(proporcao(fotos[0]), area.largura, caixaAltura);
    return [{ foto: fotos[0], x: (area.largura - r.largura) / 2, y: 0, ...r }];
  }

  if (n === 2) {
    // Linha justificada: as duas com a mesma altura, larguras proporcionais.
    const ordem = agruparPorOrientacao(fotos, [2])[0];
    const somaProp = proporcao(ordem[0]) + proporcao(ordem[1]);
    const altura = Math.min((area.largura - gH) / somaProp, area.altura - hL);
    const larguras = ordem.map((f) => altura * proporcao(f));
    const larguraLinha = larguras[0] + larguras[1] + gH;
    let x = (area.largura - larguraLinha) / 2;
    return ordem.map((foto, i) => {
      const item = { foto, x, y: 0, largura: larguras[i], altura };
      x += larguras[i] + gH;
      return item;
    });
  }

  const colunas = Math.max(...estruturaLinhas(n));
  const linhas = distribuirEmLinhas(fotos);
  const larguraCelula = (area.largura - (colunas - 1) * gH) / colunas;

  // Altura que cada linha precisaria para exibir todas as suas fotos na
  // largura total da célula.
  const demandas = linhas.map((l) => Math.max(...l.map((f) => larguraCelula / proporcao(f))));
  const alturaDisponivel = area.altura - linhas.length * hL - (linhas.length - 1) * gV;
  const alturas = repartirAltura(demandas, alturaDisponivel);

  const resultado: FotoLocal[] = [];
  let yLinha = 0;
  linhas.forEach((linha, i) => {
    const alturaLinha = alturas[i];
    const larguraLinha = linha.length * larguraCelula + (linha.length - 1) * gH;
    let xCelula = (area.largura - larguraLinha) / 2;
    for (const foto of linha) {
      const r = contain(proporcao(foto), larguraCelula, alturaLinha);
      resultado.push({
        foto,
        x: xCelula + (larguraCelula - r.largura) / 2,
        // Alinhadas pela base, para que as legendas da linha fiquem alinhadas.
        y: yLinha + (alturaLinha - r.altura),
        ...r,
      });
      xCelula += larguraCelula + gH;
    }
    yLinha += alturaLinha + hL + gV;
  });
  return resultado;
}

/** Aloca todas as fotos nas páginas e numera na ordem de leitura. */
export function alocarFotos(fotos: FotoEntrada[], area: Area, opcoes: OpcoesLayout = OPCOES_PADRAO): PaginaFotos[] {
  for (const f of fotos) {
    if (!(f.largura > 0 && f.altura > 0)) {
      throw new Error(`Foto ${f.id} com dimensões inválidas (${f.largura}×${f.altura})`);
    }
  }

  const paginas: PaginaFotos[] = [];
  let inicio = 0;
  let numero = 1;
  for (const quantidade of distribuirPaginas(fotos.length)) {
    const daPagina = fotos.slice(inicio, inicio + quantidade);
    inicio += quantidade;
    const posicionadas = posicionarPagina(daPagina, area, opcoes);
    paginas.push({
      fotos: posicionadas.map((p) => ({
        id: p.foto.id,
        numero: numero++,
        x: p.x,
        y: p.y,
        largura: p.largura,
        altura: p.altura,
        legenda: { x: p.x, y: p.y + p.altura, largura: p.largura, altura: opcoes.alturaLegenda },
      })),
    });
  }
  return paginas;
}
