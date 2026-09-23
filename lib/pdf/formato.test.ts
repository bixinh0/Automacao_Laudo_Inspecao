import { describe, expect, it } from "vitest";
import { diaLocal, formatarDataHora, nomesUnicos, pastaDoDia, rotuloDoDia } from "./formato";

describe("datas no fuso da fábrica", () => {
  it("diaLocal usa o dia de São Paulo, não o de UTC", () => {
    expect(diaLocal(new Date("2026-09-23T15:00:00Z"))).toBe("2026-09-23");
    // 01:30 UTC de 24/09 = 22:30 de 23/09 em São Paulo.
    expect(diaLocal(new Date("2026-09-24T01:30:00Z"))).toBe("2026-09-23");
    expect(diaLocal(new Date("2026-09-24T03:00:00Z"))).toBe("2026-09-24");
  });
  it("pasta dd-mm e rótulo dd/mm/aaaa", () => {
    expect(pastaDoDia("2026-09-03")).toBe("03-09");
    expect(rotuloDoDia("2026-09-03")).toBe("03/09/2026");
  });
  it("data e hora de emissão", () => {
    expect(formatarDataHora(new Date("2026-09-23T17:43:00Z"))).toBe("23/09/2026 às 14:43");
  });
});

describe("nomesUnicos", () => {
  it("numera repetições sem mexer nos demais", () => {
    expect(nomesUnicos(["laudo-OP-1.pdf", "laudo-OP-2.pdf", "laudo-OP-1.pdf", "laudo-OP-1.pdf"])).toEqual([
      "laudo-OP-1.pdf",
      "laudo-OP-2.pdf",
      "laudo-OP-1 (2).pdf",
      "laudo-OP-1 (3).pdf",
    ]);
  });
});
