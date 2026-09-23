/** Data e hora no fuso da fábrica (a Vercel roda em UTC). */
export function formatarDataHora(data: Date): string {
  const fuso = process.env.FUSO_HORARIO || "America/Sao_Paulo";
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(data);
  return `${dia} às ${hora}`;
}
