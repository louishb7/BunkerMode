import { BadRequestException } from "@nestjs/common";
import { parseIsoDate, optionalText } from "../common/domain-helpers";
import { PracticeIntent, PracticePlan, practiceDate } from "./practice-domain";

export function practiceAmount(
  value: unknown,
  allowZero = false,
): number | null {
  if (value == null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value > 1_000_000_000 ||
    (allowZero ? value < 0 : value <= 0) ||
    Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001
  )
    throw new BadRequestException(
      "Quantidade inválida. Use até três casas decimais.",
    );
  return value;
}
export function validatePracticePlan(
  raw: unknown,
  intent: PracticeIntent,
  timezone: string,
): PracticePlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestException("Informe o plano da prática.");
  const data = raw as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          "effective_from",
          "frequency",
          "weekdays",
          "times_per_week",
          "target_amount",
          "unit",
          "timezone",
        ].includes(key),
    )
  )
    throw new BadRequestException("Campos do plano inválidos.");
  const from = parseIsoDate(data.effective_from, "Data de início inválida.");
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== "string")
      throw new BadRequestException("Fuso horário inválido.");
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: data.timezone }).format(
        new Date(),
      );
      timezone = data.timezone;
    } catch {
      throw new BadRequestException("Fuso horário inválido.");
    }
  }
  if (!from || from.getUTCFullYear() < 2000 || from.getUTCFullYear() > 2100)
    throw new BadRequestException(
      "Informe uma data de início entre 2000 e 2100.",
    );
  const frequency = data.frequency;
  if (!["diaria", "dias_fixos", "semanal"].includes(String(frequency)))
    throw new BadRequestException("Frequência inválida.");
  const weekdays = data.weekdays ?? [];
  if (
    !Array.isArray(weekdays) ||
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new BadRequestException("Dias da semana inválidos.");
  const normalizedDays = [...new Set(weekdays as number[])].sort();
  if (frequency === "dias_fixos" && !normalizedDays.length)
    throw new BadRequestException("Escolha ao menos um dia.");
  const amount = practiceAmount(data.target_amount);
  if (intent === "reduzir" && amount == null)
    throw new BadRequestException(
      "Informe o limite de quantidade que deseja reduzir.",
    );
  if (intent === "evitar" && amount != null)
    throw new BadRequestException(
      "Evitação usa ocorrências e confirmação explícita, sem meta de quantidade.",
    );
  if (intent === "evitar" && frequency === "semanal")
    throw new BadRequestException(
      "Para evitar, escolha todos os dias ou dias fixos.",
    );
  const unit = optionalText(data.unit, "Unidade inválida.");
  if (unit && unit.length > 40)
    throw new BadRequestException("Unidade deve ter até 40 caracteres.");
  if (unit && amount == null)
    throw new BadRequestException("A unidade exige uma meta de quantidade.");
  const times = data.times_per_week;
  if (
    frequency === "semanal" &&
    amount == null &&
    (typeof times !== "number" ||
      !Number.isInteger(times) ||
      times < 1 ||
      times > 100)
  )
    throw new BadRequestException("Informe de 1 a 100 vezes por semana.");
  if (times != null && (frequency !== "semanal" || amount != null))
    throw new BadRequestException(
      "Meta semanal de quantidade não usa número de sessões.",
    );
  return {
    effective_from: from.toISOString().slice(0, 10),
    effective_until: null,
    frequency: frequency as PracticePlan["frequency"],
    weekdays: frequency === "dias_fixos" ? normalizedDays : [],
    times_per_week:
      frequency === "semanal" && amount == null ? (times as number) : null,
    target_amount: amount,
    unit: unit ?? null,
    paused: false,
    timezone,
  };
}
export function validatePlanChange(
  from: string,
  timezone: string,
  lastFrom: string,
  hasRecordsAtStart: boolean,
  capturedAt = new Date(),
) {
  if (from < practiceDate(capturedAt, timezone))
    throw new BadRequestException(
      "Uma mudança de plano deve começar na data do comando ou depois. O histórico permanece no plano anterior.",
    );
  if (from < lastFrom || hasRecordsAtStart)
    throw new BadRequestException(
      "Já há histórico ou um plano nesta data. Escolha uma vigência posterior.",
    );
}
