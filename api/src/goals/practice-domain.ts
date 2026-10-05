// Projeção factual compartilhada pela API e pela web, inclusive com intenções offline.
// Não depende de NestJS, Prisma, React ou da entidade Tarefa.
export type PracticeIntent =
  "registro_livre" | "repetir" | "reduzir" | "evitar";
export type PracticeFrequency = "diaria" | "dias_fixos" | "semanal";
export type PracticePlan = {
  id?: number | string;
  effective_from: string;
  effective_until?: string | null;
  frequency: PracticeFrequency;
  weekdays: number[];
  times_per_week?: number | null;
  target_amount?: number | null;
  unit?: string | null;
  paused: boolean;
  timezone: string;
};
export type PracticeRecord = {
  id: number | string;
  occurred_at: string;
  created_at?: string;
  recorded_at?: string | null;
  kind?: "atividade" | "ocorrencia" | "confirmacao";
  amount?: number | null;
  unit?: string | null;
  note?: string | null;
};
export type PracticeData = {
  intent?: PracticeIntent;
  status?: string;
  planos?: PracticePlan[];
  ocorrencias: PracticeRecord[];
};
export type PracticePeriod = {
  start: string;
  end: string;
  frequency: PracticeFrequency;
  target: number;
  amount: number;
  unit: string | null;
  closed: boolean;
  eligible: boolean;
  confirmed: boolean;
  status:
    | "cumprida"
    | "em_andamento"
    | "desconhecido"
    | "observado"
    | "limite_ultrapassado";
};
export function practiceDate(
  moment: Date | string,
  timezone = "America/Recife",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(moment));
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}
// Interpreta a entrada de calendário no fuso da prática, não no fuso do navegador.
export function practiceLocalTime(
  moment: Date | string,
  timezone = "America/Recife",
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(moment));
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
export function practiceInstant(
  local: string,
  timezone = "America/Recife",
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Data e hora inválidas.");
  const target = Date.parse(`${local}:00Z`);
  let candidate = target;
  for (let attempt = 0; attempt < 3 && Number.isFinite(candidate); attempt++) {
    const projected = Date.parse(
      `${practiceLocalTime(new Date(candidate), timezone)}:00Z`,
    );
    candidate += target - projected;
  }
  if (
    !Number.isFinite(candidate) ||
    practiceLocalTime(new Date(candidate), timezone) !== local
  )
    throw new Error("Esta data e hora não existem no fuso da prática.");
  return new Date(candidate).toISOString();
}
export function addPracticeDays(day: string, amount: number): string {
  const value = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
const isoDay = (value: string) => value.slice(0, 10);
const mondayWeekday = (day: string) =>
  (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
export function planOn(
  plans: PracticePlan[],
  day: string,
): PracticePlan | undefined {
  return [...plans]
    .sort((a, b) =>
      isoDay(b.effective_from).localeCompare(isoDay(a.effective_from)),
    )
    .find(
      (plan) =>
        isoDay(plan.effective_from) <= day &&
        (!plan.effective_until || day < isoDay(plan.effective_until)),
    );
}
export function practicePlanSignature(plan: PracticePlan): string {
  return JSON.stringify([
    plan.effective_from,
    plan.frequency,
    [...plan.weekdays].sort(),
    plan.times_per_week ?? null,
    plan.target_amount ?? null,
    plan.unit ?? null,
    Boolean(plan.paused),
    plan.timezone,
  ]);
}
export function practicePlanLabel(plan?: PracticePlan | null): string {
  if (!plan) return "Registro livre";
  if (plan.frequency === "diaria") return "Todos os dias";
  if (plan.frequency === "dias_fixos")
    return plan.weekdays
      .map((day) => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day])
      .join(", ");
  return plan.target_amount != null
    ? "Meta por semana"
    : `${plan.times_per_week} vezes por semana`;
}
export function derivePractice(
  practice: PracticeData,
  now = new Date(),
  fallbackTimezone = "America/Recife",
) {
  const intent = practice.intent ?? "registro_livre";
  const plans = [...(practice.planos ?? [])].sort((a, b) =>
    isoDay(a.effective_from).localeCompare(isoDay(b.effective_from)),
  );
  const timezone = plans[0]?.timezone ?? fallbackTimezone;
  const today = practiceDate(now, timezone);
  const records = practice.ocorrencias.filter(
    (record) =>
      Number.isFinite(Date.parse(record.occurred_at)) &&
      Date.parse(record.occurred_at) <= now.getTime(),
  );
  const datedRecords = records.map((record) => ({
    record,
    day: practiceDate(record.occurred_at, timezone),
  }));
  const currentPlan = planOn(plans, today);
  const periods: PracticePeriod[] = [];
  for (const plan of intent === "registro_livre" ? [] : plans) {
    if (plan.paused) continue;
    const first = isoDay(plan.effective_from);
    const last = plan.effective_until
      ? addPracticeDays(isoDay(plan.effective_until), -1)
      : today;
    if (first > today || first > last) continue;
    let day =
      plan.frequency === "semanal"
        ? addPracticeDays(first, -mondayWeekday(first))
        : first;
    while (day <= today && day <= last) {
      const weekly = plan.frequency === "semanal";
      const weekEnd = weekly ? addPracticeDays(day, 6) : day;
      const start = day < first ? first : day;
      const end = weekEnd > last && plan.effective_until ? last : weekEnd;
      if (
        !weekly &&
        plan.frequency === "dias_fixos" &&
        !plan.weekdays.includes(mondayWeekday(day))
      ) {
        day = addPracticeDays(day, 1);
        continue;
      }
      // Semanas interrompidas por início, troca de plano ou pausa são fatos parciais;
      // não recebem um denominador de semana completa nem uma meta proporcional inventada.
      const eligible = !weekly || (start === day && end === weekEnd);
      const inPeriod = datedRecords
        .filter((item) => item.day >= start && item.day <= end)
        .map((item) => item.record);
      const activity = inPeriod.filter((record) =>
        intent === "repetir"
          ? record.kind === "atividade"
          : record.kind !== "confirmacao",
      );
      const amount =
        plan.target_amount == null
          ? activity.length
          : activity.reduce(
              (sum, record) => sum + Math.round((record.amount ?? 0) * 1000),
              0,
            ) / 1000;
      const target =
        plan.target_amount ?? (weekly ? (plan.times_per_week ?? 1) : 1);
      const closed = end < today;
      const confirmed = inPeriod.some((record) => {
        if (record.kind !== "confirmacao") return false;
        const captured = record.recorded_at ?? record.created_at;
        return !captured || end < practiceDate(captured, timezone);
      });
      let status: PracticePeriod["status"];
      if (intent === "repetir")
        status =
          amount >= target
            ? "cumprida"
            : activity.length
              ? closed
                ? "observado"
                : "em_andamento"
              : "desconhecido";
      else {
        const limit = intent === "evitar" ? 0 : target;
        // Uma ocorrência nunca é interpretada como ausência; confirmar sem ocorrência
        // é um registro explícito, e uma ocorrência posterior invalida apenas o período.
        status =
          amount > limit
            ? "limite_ultrapassado"
            : closed && confirmed
              ? "cumprida"
              : confirmed || activity.length
                ? "observado"
                : "desconhecido";
      }
      periods.push({
        start,
        end,
        frequency: plan.frequency,
        target: intent === "evitar" ? 0 : target,
        amount,
        unit:
          plan.target_amount != null
            ? (plan.unit ?? "unidades")
            : weekly && intent === "repetir"
              ? "vezes"
              : null,
        closed,
        eligible,
        confirmed,
        status,
      });
      day = addPracticeDays(day, weekly ? 7 : 1);
    }
  }
  periods.sort((a, b) => a.start.localeCompare(b.start));
  const eligible = periods.filter((period) => period.eligible);
  const closed = eligible.filter((period) => period.closed);
  const fulfilled = closed.filter((period) => period.status === "cumprida");
  let currentStreak = 0,
    bestStreak = 0;
  for (const period of eligible.filter(
    (period) =>
      period.closed ||
      period.status === "cumprida" ||
      period.status === "limite_ultrapassado",
  )) {
    currentStreak = period.status === "cumprida" ? currentStreak + 1 : 0;
    bestStreak = Math.max(bestStreak, currentStreak);
  }
  const quantities = new Map<string, number>();
  for (const { record, day } of datedRecords) {
    if (record.kind === "confirmacao" || record.amount == null) continue;
    const unit = record.unit ?? planOn(plans, day)?.unit ?? "unidades";
    quantities.set(
      unit,
      (quantities.get(unit) ?? 0) + Math.round(record.amount * 1000),
    );
  }
  const quantityTotals = [...quantities].map(([unit, value]) => ({
    unit,
    amount: value / 1000,
  }));
  const milestones: string[] = [];
  if (records.length >= 10) milestones.push("10 registros");
  if (fulfilled.filter((period) => period.frequency === "semanal").length >= 4)
    milestones.push("4 semanas com meta registrada");
  for (const item of quantityTotals)
    if (item.amount >= 1000) milestones.push(`1000 ${item.unit} registrados`);
  return {
    today,
    currentPlan,
    current:
      [...periods]
        .reverse()
        .find((period) => period.start <= today && period.end >= today) ?? null,
    recordCount: records.length,
    quantityTotals,
    periods,
    closedExpected: closed.length,
    closedFulfilled: fulfilled.length,
    unknown: closed.filter((period) => period.status === "desconhecido").length,
    currentStreak,
    bestStreak,
    milestones,
    windows: [7, 30, 60, 90].map((days) => {
      const first = addPracticeDays(today, -days);
      const window = closed.filter((period) => period.end >= first);
      return {
        days,
        expected: window.length,
        fulfilled: window.filter((period) => period.status === "cumprida")
          .length,
        unknown: window.filter((period) => period.status === "desconhecido")
          .length,
      };
    }),
  };
}
export function practiceFact(
  practice: PracticeData,
  now = new Date(),
  timezone = "America/Recife",
): string {
  const facts = derivePractice(practice, now, timezone);
  if (
    facts.currentPlan?.paused ||
    ((!practice.intent || practice.intent === "registro_livre") &&
      practice.status === "pausado")
  )
    return "Pausado";
  if ((practice.intent ?? "registro_livre") === "registro_livre")
    return `${facts.recordCount} ${facts.recordCount === 1 ? "registro" : "registros"}`;
  const period = facts.current;
  if (!period)
    return facts.currentPlan
      ? "Sem oportunidade prevista hoje"
      : "A prática ainda não começou";
  if (practice.intent === "repetir")
    return period.unit
      ? `${period.amount}/${period.target} ${period.unit} · ${period.frequency === "semanal" ? "semana" : "hoje"}`
      : period.status === "cumprida"
        ? "Prática registrada hoje"
        : "Sem registro hoje";
  if (period.status === "limite_ultrapassado")
    return practice.intent === "evitar"
      ? "Ocorrência registrada no período"
      : `${period.amount} ${period.unit ?? "ocorrências"} · acima do limite escolhido`;
  return period.status === "desconhecido"
    ? "Período sem informação"
    : period.confirmed
      ? "Período observado · confirmação registrada"
      : `${period.amount} ${period.unit ?? "ocorrências"} registrados no período`;
}
