import {
  derivePractice,
  practiceFact,
  practiceInstant,
  practiceLocalTime,
  PracticeData,
  PracticePlan,
  PracticeRecord,
} from "../src/goals/practice-domain";
import {
  validatePracticePlan,
  validatePlanChange,
} from "../src/goals/practice-validation";

const now = new Date("2026-10-05T18:00:00Z");
const plan = (changes: Partial<PracticePlan> = {}): PracticePlan => ({
  effective_from: "2026-09-28",
  effective_until: null,
  frequency: "diaria",
  weekdays: [],
  target_amount: null,
  times_per_week: null,
  unit: null,
  paused: false,
  timezone: "America/Recife",
  ...changes,
});
const record = (
  day: string,
  changes: Partial<PracticeRecord> = {},
): PracticeRecord => ({
  id: `${day}-${Math.random()}`,
  occurred_at: `${day}T18:00:00Z`,
  kind: "atividade",
  ...changes,
});
const practice = (changes: Partial<PracticeData> = {}): PracticeData => ({
  intent: "repetir",
  planos: [plan()],
  ocorrencias: [],
  ...changes,
});

describe("Práticas registradas e consistência factual", () => {
  it("prática qualitativa diária conta oportunidades encerradas e mantém ausência desconhecida", () => {
    const facts = derivePractice(
      practice({ ocorrencias: [record("2026-09-28"), record("2026-10-05")] }),
      now,
    );
    expect(facts).toMatchObject({
      closedExpected: 7,
      closedFulfilled: 1,
      unknown: 6,
    });
    expect(facts.current).toMatchObject({
      status: "cumprida",
      amount: 1,
      closed: false,
    });
  });
  it("soma registros parciais quantitativos sem substituir os eventos", () => {
    const data = practice({
      planos: [plan({ target_amount: 30, unit: "páginas" })],
      ocorrencias: [
        record("2026-10-05", { amount: 20 }),
        record("2026-10-05", { amount: 10 }),
      ],
    });
    expect(derivePractice(data, now).current).toMatchObject({
      amount: 30,
      target: 30,
      status: "cumprida",
    });
    expect(data.ocorrencias).toHaveLength(2);
    expect(practiceFact(data, now)).toBe("30/30 páginas · hoje");
  });
  it("quantidades decimais não perdem precisão na soma de parciais", () => {
    expect(
      derivePractice(
        practice({
          planos: [plan({ target_amount: 0.3, unit: "litros" })],
          ocorrencias: [
            record("2026-10-05", { amount: 0.1 }),
            record("2026-10-05", { amount: 0.2 }),
          ],
        }),
        now,
      ).current?.status,
    ).toBe("cumprida");
  });
  it("dias fixos produzem somente as oportunidades previstas", () => {
    const facts = derivePractice(
      practice({
        planos: [plan({ frequency: "dias_fixos", weekdays: [0, 2, 4] })],
      }),
      now,
    );
    expect(facts.closedExpected).toBe(3);
    expect(facts.periods.map((item) => item.start)).toEqual([
      "2026-09-28",
      "2026-09-30",
      "2026-10-02",
      "2026-10-05",
    ]);
  });
  it("três vezes por semana permite dias livres e não cria três dias fixos", () => {
    const facts = derivePractice(
      practice({
        planos: [plan({ frequency: "semanal", times_per_week: 3 })],
        ocorrencias: [
          record("2026-09-29"),
          record("2026-10-01"),
          record("2026-10-04"),
        ],
      }),
      now,
    );
    expect(facts).toMatchObject({ closedExpected: 1, closedFulfilled: 1 });
    expect(facts.periods[0]).toMatchObject({
      start: "2026-09-28",
      end: "2026-10-04",
      amount: 3,
      target: 3,
    });
  });
  it("a meta semanal quantitativa acumula a quantidade em vez de contar sessões", () => {
    const facts = derivePractice(
      practice({
        planos: [
          plan({ frequency: "semanal", target_amount: 100, unit: "páginas" }),
        ],
        ocorrencias: [
          record("2026-09-29", { amount: 60 }),
          record("2026-10-04", { amount: 40 }),
        ],
      }),
      now,
    );
    expect(facts.closedFulfilled).toBe(1);
    expect(facts.quantityTotals).toEqual([{ unit: "páginas", amount: 100 }]);
  });
  it("alterar 10 para 30 preserva o resultado de períodos antigos", () => {
    const facts = derivePractice(
      practice({
        planos: [
          plan({
            effective_until: "2026-10-05",
            target_amount: 10,
            unit: "páginas",
          }),
          plan({
            effective_from: "2026-10-05",
            target_amount: 30,
            unit: "páginas",
          }),
        ],
        ocorrencias: [
          record("2026-10-04", { amount: 10 }),
          record("2026-10-05", { amount: 10 }),
        ],
      }),
      now,
    );
    expect(
      facts.periods.find((item) => item.start === "2026-10-04"),
    ).toMatchObject({ target: 10, status: "cumprida" });
    expect(facts.current).toMatchObject({ target: 30, status: "em_andamento" });
  });
  it("pausas e períodos anteriores ao início não entram no denominador", () => {
    const facts = derivePractice(
      practice({
        planos: [
          plan({ effective_until: "2026-10-01" }),
          plan({
            effective_from: "2026-10-01",
            effective_until: "2026-10-04",
            paused: true,
          }),
          plan({ effective_from: "2026-10-04" }),
        ],
      }),
      now,
    );
    expect(facts.closedExpected).toBe(4);
    expect(facts.periods.some((item) => item.start === "2026-10-02")).toBe(
      false,
    );
  });
  it("semanas incompletas por início ou mudança não inventam uma meta proporcional", () => {
    const facts = derivePractice(
      practice({
        planos: [
          plan({
            effective_from: "2026-09-30",
            frequency: "semanal",
            times_per_week: 3,
          }),
        ],
        ocorrencias: [record("2026-10-01")],
      }),
      now,
    );
    expect(facts.periods[0]).toMatchObject({
      eligible: false,
      amount: 1,
      target: 3,
    });
    expect(facts.closedExpected).toBe(0);
  });
  it("sincronizar segunda um registro de domingo preserva a oportunidade de domingo", () => {
    const facts = derivePractice(
      practice({
        ocorrencias: [
          record("2026-10-04", {
            created_at: now.toISOString(),
            recorded_at: "2026-10-04T18:01:00Z",
          }),
        ],
      }),
      now,
    );
    expect(
      facts.periods.find((item) => item.start === "2026-10-04")?.status,
    ).toBe("cumprida");
    expect(facts.current?.status).toBe("desconhecido");
  });
  it("reduzir usa limite e confirmação explícita, nunca presume sucesso pelo silêncio", () => {
    const facts = derivePractice(
      practice({
        intent: "reduzir",
        planos: [plan({ target_amount: 2, unit: "copos" })],
        ocorrencias: [
          record("2026-10-01", { kind: "ocorrencia", amount: 1 }),
          record("2026-10-02", { kind: "ocorrencia", amount: 1 }),
          record("2026-10-02", { kind: "confirmacao" }),
          record("2026-10-03", { kind: "ocorrencia", amount: 3 }),
          record("2026-10-03", { kind: "confirmacao" }),
        ],
      }),
      now,
    );
    expect(facts.closedFulfilled).toBe(1);
    expect(
      facts.periods.find((item) => item.start === "2026-10-01")?.status,
    ).toBe("observado");
    expect(
      facts.periods.find((item) => item.start === "2026-10-03")?.status,
    ).toBe("limite_ultrapassado");
    expect(facts.unknown).toBe(4);
  });
  it("quatro dias sem abrir o aplicativo não são quatro dias de evitação confirmada", () => {
    const facts = derivePractice(
      practice({
        intent: "evitar",
        planos: [plan({ effective_from: "2026-10-01" })],
      }),
      now,
    );
    expect(facts).toMatchObject({
      closedExpected: 4,
      closedFulfilled: 0,
      unknown: 4,
      currentStreak: 0,
      bestStreak: 0,
    });
  });
  it("ocorrência interrompe a sequência confirmada e preserva melhor sequência e história", () => {
    const records = [1, 2, 3].map((day) =>
      record(`2026-10-0${day}`, { kind: "confirmacao" }),
    );
    const data = practice({
      intent: "evitar",
      planos: [plan({ effective_from: "2026-10-01" })],
      ocorrencias: [...records, record("2026-10-04", { kind: "ocorrencia" })],
    });
    expect(derivePractice(data, now)).toMatchObject({
      currentStreak: 0,
      bestStreak: 3,
      recordCount: 4,
      closedFulfilled: 3,
    });
    expect(data.ocorrencias).toHaveLength(4);
  });
  it("confirmar hoje não garante a ausência no resto do dia", () => {
    const data = practice({
      intent: "evitar",
      ocorrencias: [record("2026-10-05", { kind: "confirmacao" })],
    });
    expect(derivePractice(data, now).current?.status).toBe("observado");
    data.ocorrencias.push(record("2026-10-05", { kind: "ocorrencia" }));
    expect(derivePractice(data, now).current?.status).toBe(
      "limite_ultrapassado",
    );
  });
  it("trackers antigos permanecem registro livre sem oportunidades ou inferências", () => {
    const facts = derivePractice(
      { ocorrencias: [record("2026-10-01", { kind: undefined })] },
      now,
    );
    expect(facts).toMatchObject({
      recordCount: 1,
      closedExpected: 0,
      closedFulfilled: 0,
      currentStreak: 0,
      bestStreak: 0,
    });
    expect(facts.periods).toEqual([]);
  });
  it("marcos são fatos de atividade e unidades distintas não são somadas", () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      record("2026-10-04", {
        id: index,
        amount: index < 5 ? 200 : 1,
        unit: index < 5 ? "páginas" : "minutos",
      }),
    );
    const facts = derivePractice(practice({ ocorrencias: records }), now);
    expect(facts.quantityTotals).toEqual([
      { unit: "páginas", amount: 1000 },
      { unit: "minutos", amount: 5 },
    ]);
    expect(facts.milestones).toEqual([
      "10 registros",
      "1000 páginas registrados",
    ]);
  });
  it("o calendário da prática respeita o fuso e exclui o futuro", () => {
    const facts = derivePractice(
      practice({
        ocorrencias: [
          { id: 1, occurred_at: "2026-10-05T01:00:00Z", kind: "atividade" },
          record("2026-10-06"),
        ],
      }),
      now,
    );
    expect(
      facts.periods.find((item) => item.start === "2026-10-04")?.status,
    ).toBe("cumprida");
    expect(facts.recordCount).toBe(1);
    expect(facts.closedExpected).toBe(7);
  });
  it("recusa planos ambíguos, precisão inválida e mudança retroativa", () => {
    const input = {
      effective_from: "2026-10-05",
      frequency: "semanal",
      times_per_week: 3,
      weekdays: [],
    };
    expect(
      validatePracticePlan(input, "repetir", "America/Recife"),
    ).toMatchObject({ times_per_week: 3, weekdays: [] });
    for (const invalid of [
      { ...input, times_per_week: 0 },
      { ...input, target_amount: 10 },
      { ...input, frequency: "dias_fixos" },
      { ...input, target_amount: 0.1234 },
      { ...input, timezone: "invalid" },
    ])
      expect(() =>
        validatePracticePlan(invalid, "repetir", "America/Recife"),
      ).toThrow();
    expect(() =>
      validatePlanChange("2000-01-01", "America/Recife", "2000-01-01", false),
    ).toThrow();
  });
  it("confirmação capturada antes de encerrar o período não inventa sucesso na sincronização posterior", () => {
    const data = practice({
      intent: "evitar",
      ocorrencias: [
        record("2026-10-04", {
          kind: "confirmacao",
          recorded_at: "2026-10-04T18:01:00Z",
          created_at: now.toISOString(),
        }),
      ],
    });
    expect(derivePractice(data, now).closedFulfilled).toBe(0);
  });
  it("limite semanal de redução usa quantidades e confirmação, sem dias obrigatórios", () => {
    const configuration = validatePracticePlan(
      {
        effective_from: "2026-09-28",
        frequency: "semanal",
        target_amount: 3,
        unit: "copos",
      },
      "reduzir",
      "America/Recife",
    );
    const facts = derivePractice(
      practice({
        intent: "reduzir",
        planos: [configuration],
        ocorrencias: [
          record("2026-09-30", { kind: "ocorrencia", amount: 2 }),
          record("2026-10-04", {
            kind: "confirmacao",
            recorded_at: now.toISOString(),
          }),
        ],
      }),
      now,
    );
    expect(facts).toMatchObject({ closedExpected: 1, closedFulfilled: 1 });
  });
  it("mudanças locais preservam a data do comando, mas nunca reinterpretam dias com registros", () => {
    expect(() =>
      validatePlanChange(
        "2026-10-04",
        "America/Recife",
        "2026-10-01",
        false,
        new Date("2026-10-04T18:00:00Z"),
      ),
    ).not.toThrow();
    expect(() =>
      validatePlanChange(
        "2026-10-04",
        "America/Recife",
        "2026-10-01",
        true,
        new Date("2026-10-04T18:00:00Z"),
      ),
    ).toThrow();
  });
  it("datas digitadas usam o fuso da prática e rejeitam lacunas de horário de verão", () => {
    expect(practiceInstant("2026-10-04T15:00", "America/Recife")).toBe(
      "2026-10-04T18:00:00.000Z",
    );
    expect(practiceLocalTime("2026-10-04T18:00:00Z", "America/Recife")).toBe(
      "2026-10-04T15:00",
    );
    expect(() =>
      practiceInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      practiceInstant("2026-02-30T12:00", "America/Recife"),
    ).toThrow();
  });
  it("registro parcial de um período encerrado é observação, sem estado de execução em andamento", () => {
    const facts = derivePractice(
      practice({
        planos: [plan({ target_amount: 30 })],
        ocorrencias: [record("2026-10-04", { amount: 20 })],
      }),
      now,
    );
    expect(
      facts.periods.find((period) => period.start === "2026-10-04")?.status,
    ).toBe("observado");
  });
});
