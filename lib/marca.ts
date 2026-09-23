/**
 * Identidade visual da Vanderhulst, usada no site e no PDF.
 *
 * O símbolo (duas correias sobre três polias formando um "V") é redesenhado
 * em vetor a partir do logotipo: três círculos e as tangentes entre eles.
 */

export const MARCA = {
  nome: "VANDERHULST",
  cores: {
    azul: "#2399D6", // azul da marca
    azulEscuro: "#0B4F80",
    marinho: "#0E2A47",
    cinzaEscuro: "#3D4A57",
    cinza: "#6B7785",
    cinzaClaro: "#D5DCE3",
    fundo: "#F2F4F7",
  },
};

interface Circulo {
  cx: number;
  cy: number;
  r: number;
}

const POLIA_ESQUERDA: Circulo = { cx: 62, cy: 62, r: 51 };
const POLIA_DIREITA: Circulo = { cx: 450, cy: 62, r: 51 };
const POLIA_INFERIOR: Circulo = { cx: 256, cy: 436, r: 36 };

/** Tangentes externas entre duas polias: os dois lados da correia. */
function correia(a: Circulo, b: Circulo) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const angulo = Math.atan2(dy, dx);
  const abertura = Math.acos((a.r - b.r) / Math.hypot(dx, dy));
  return [angulo + abertura, angulo - abertura].map((f) => ({
    x1: a.cx + a.r * Math.cos(f),
    y1: a.cy + a.r * Math.sin(f),
    x2: b.cx + b.r * Math.cos(f),
    y2: b.cy + b.r * Math.sin(f),
  }));
}

export const SIMBOLO = {
  largura: 512,
  altura: 503,
  espessura: 22,
  circulos: [POLIA_ESQUERDA, POLIA_DIREITA, POLIA_INFERIOR],
  linhas: [...correia(POLIA_ESQUERDA, POLIA_INFERIOR), ...correia(POLIA_DIREITA, POLIA_INFERIOR)],
};

/** SVG do símbolo como texto (ícone do site). */
export function svgSimbolo(cor: string = MARCA.cores.azul, fundo?: string) {
  const { largura, altura, espessura, circulos, linhas } = SIMBOLO;
  const margem = fundo ? 60 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margem} ${-margem} ${largura + 2 * margem} ${altura + 2 * margem}">${
    fundo ? `<rect x="${-margem}" y="${-margem}" width="${largura + 2 * margem}" height="${altura + 2 * margem}" rx="90" fill="${fundo}"/>` : ""
  }<g fill="none" stroke="${cor}" stroke-width="${espessura}" stroke-linecap="round">${circulos
    .map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`)
    .join("")}${linhas
    .map((l) => `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}"/>`)
    .join("")}</g></svg>`;
}
