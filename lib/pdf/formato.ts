function fuso() {
  return process.env.FUSO_HORARIO || "America/Sao_Paulo";
}

/** Data e hora no fuso da fábrica (a Vercel roda em UTC). */
export function formatarDataHora(data: Date): string {
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso(), day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso(), hour: "2-digit", minute: "2-digit" }).format(data);
  return `${dia} às ${hora}`;
}

/** Dia no fuso da fábrica, no formato AAAA-MM-DD (um laudo das 23:30 pertence àquele dia, não ao seguinte em UTC). */
export function diaLocal(data: Date): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso(), year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

/** "2026-09-23" → "23-09", o nome da pasta do dia no drive. */
export function pastaDoDia(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}-${mes}`;
}

/** "2026-09-23" → "23/09/2026". */
export function rotuloDoDia(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

/** Evita nomes repetidos no ZIP: "laudo-OP-1.pdf", "laudo-OP-1 (2).pdf"… */
export function nomesUnicos(nomes: string[]): string[] {
  const usados = new Map<string, number>();
  return nomes.map((nome) => {
    const n = (usados.get(nome) ?? 0) + 1;
    usados.set(nome, n);
    return n === 1 ? nome : nome.replace(/(\.[^.]+)?$/, ` (${n})$1`);
  });
}
