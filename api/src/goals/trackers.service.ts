import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { UserRecord } from "../auth/auth.types";
import {
  optionalText,
  positiveInt,
  requiredText,
  eventTimestamp,
  parseIsoDate,
} from "../common/domain-helpers";
import { PrismaService } from "../prisma/prisma.service";
import {
  PracticeIntent,
  PracticePlan,
  planOn,
  practiceDate,
  addPracticeDays,
  practicePlanSignature,
} from "./practice-domain";
import {
  practiceAmount,
  validatePracticePlan,
  validatePlanChange,
} from "./practice-validation";
import { practicePlanResponse } from "./practice-response";

type TrackerPayload = {
  objetivo_id?: unknown;
  titulo?: unknown;
  descricao?: unknown;
  intent?: unknown;
  status?: unknown;
  plan?: unknown;
  effective_from?: unknown;
  recorded_at?: unknown;
};
export type PracticeRecordPayload = {
  occurred_at?: unknown;
  recorded_at?: unknown;
  kind?: unknown;
  amount?: unknown;
  note?: unknown;
  plan_effective_from?: unknown;
  unit?: unknown;
  plan_signature?: unknown;
};
const include = {
  ocorrencias: {
    orderBy: [{ occurred_at: "desc" as const }, { id: "desc" as const }],
  },
  planos: { orderBy: { effective_from: "asc" as const } },
};
function response<
  T extends {
    intent?: string;
    status?: string;
    planos?: any[];
    ocorrencias?: any[];
  },
>(row: T) {
  const planos = (row.planos ?? []).map(practicePlanResponse);
  const current = planOn(planos, practiceDate(new Date(), planos[0]?.timezone));
  return {
    ...row,
    intent: row.intent ?? "registro_livre",
    status: current
      ? current.paused
        ? "pausado"
        : "ativo"
      : (row.status ?? "ativo"),
    planos,
    ocorrencias: (row.ocorrencias ?? []).map((record) => ({
      ...record,
      amount: record.amount == null ? null : Number(record.amount),
    })),
  };
}
function planData(plan: PracticePlan) {
  return {
    effective_from: new Date(`${plan.effective_from}T00:00:00Z`),
    frequency: plan.frequency,
    weekdays: plan.weekdays,
    times_per_week: plan.times_per_week ?? null,
    target_amount: plan.target_amount ?? null,
    unit: plan.unit ?? null,
    paused: plan.paused,
    timezone: plan.timezone,
  };
}
@Injectable()
export class TrackersService {
  constructor(private readonly prisma: PrismaService) {}
  async list(user: UserRecord) {
    const rows = await this.prisma.acompanhamentos.findMany({
      where: { usuario_id: user.usuario_id },
      include,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    return rows.map(response);
  }
  async create(user: UserRecord, payload: TrackerPayload) {
    const goalId =
      payload.objetivo_id == null
        ? null
        : positiveInt(payload.objetivo_id, "Objetivo não encontrado.");
    if (goalId !== null) await this.ensureGoalOwner(user, goalId);
    const intent = payload.intent ?? "registro_livre";
    if (
      !["registro_livre", "repetir", "reduzir", "evitar"].includes(
        String(intent),
      )
    )
      throw new BadRequestException("Intenção da prática inválida.");
    if (intent === "registro_livre" && payload.plan != null)
      throw new BadRequestException(
        "Registro livre não possui meta ou frequência.",
      );
    if (payload.status !== undefined && payload.status !== "ativo")
      throw new BadRequestException("Uma prática começa ativa.");
    const plan =
      intent !== "registro_livre"
        ? validatePracticePlan(
            payload.plan,
            intent as PracticeIntent,
            user.timezone ?? "America/Recife",
          )
        : null;
    const row = await this.prisma.acompanhamentos.create({
      data: {
        objetivo_id: goalId,
        usuario_id: user.usuario_id,
        titulo: requiredText(
          payload.titulo,
          "Título do acompanhamento é obrigatório.",
          200,
        ),
        descricao: optionalText(
          payload.descricao,
          "Descrição do acompanhamento inválida.",
        ),
        ...(payload.intent !== undefined ? { intent: String(intent) } : {}),
        ...(plan ? { planos: { create: planData(plan) } } : {}),
      },
      include,
    });
    return response(row);
  }
  async update(user: UserRecord, id: number, payload: TrackerPayload) {
    const tracker = await this.findOwned(user, id);
    const intent = (tracker.intent ?? "registro_livre") as PracticeIntent;
    const captured = eventTimestamp(payload.recorded_at);
    if (payload.intent !== undefined && payload.intent !== intent)
      throw new BadRequestException(
        "A intenção preserva a semântica do histórico. Crie outro comportamento para uma nova intenção.",
      );
    const goalId =
      payload.objetivo_id == null
        ? null
        : positiveInt(payload.objetivo_id, "Objetivo não encontrado.");
    if (payload.objetivo_id !== undefined && goalId !== null)
      await this.ensureGoalOwner(user, goalId);
    if (
      payload.status !== undefined &&
      !["ativo", "pausado"].includes(String(payload.status))
    )
      throw new BadRequestException("Estado da prática inválido.");
    const data = {
      ...(payload.objetivo_id !== undefined ? { objetivo_id: goalId } : {}),
      ...(payload.titulo !== undefined
        ? {
            titulo: requiredText(
              payload.titulo,
              "Título do acompanhamento é obrigatório.",
              200,
            ),
          }
        : {}),
      ...(payload.descricao !== undefined
        ? {
            descricao: optionalText(
              payload.descricao,
              "Descrição do acompanhamento inválida.",
            ),
          }
        : {}),
      ...(payload.status !== undefined
        ? { status: String(payload.status) }
        : {}),
    };
    if (payload.plan === undefined && payload.status === undefined)
      return response(
        await this.prisma.acompanhamentos.update({
          where: { id: tracker.id },
          data,
          include,
        }),
      );
    if (intent === "registro_livre") {
      if (payload.plan !== undefined)
        throw new BadRequestException(
          "O histórico de registro livre permanece sem meta.",
        );
      return response(
        await this.prisma.acompanhamentos.update({
          where: { id: tracker.id },
          data,
          include,
        }),
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM acompanhamentos WHERE id = ${tracker.id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
      const current = await tx.acompanhamentos.findFirstOrThrow({
        where: { id: tracker.id, usuario_id: user.usuario_id },
        include,
      });
      const plans = current.planos.map(practicePlanResponse);
      const last = plans.at(-1);
      if (!last)
        throw new BadRequestException("Plano da prática não encontrado.");
      if (
        payload.plan &&
        typeof payload.plan === "object" &&
        "timezone" in payload.plan &&
        payload.plan.timezone !== last.timezone
      )
        throw new BadRequestException(
          "O fuso da prática preserva seu calendário histórico.",
        );
      const next =
        payload.plan !== undefined
          ? validatePracticePlan(payload.plan, intent, last.timezone)
          : {
              ...last,
              effective_from:
                parseIsoDate(
                  payload.effective_from,
                  "Vigência da pausa inválida.",
                )
                  ?.toISOString()
                  .slice(0, 10) ?? practiceDate(captured, last.timezone),
              effective_until: null,
            };
      next.paused =
        payload.status !== undefined
          ? payload.status === "pausado"
          : last.paused;
      const hasRecords = current.ocorrencias.some(
        (record) =>
          practiceDate(record.occurred_at, last.timezone) >=
          next.effective_from,
      );
      validatePlanChange(
        next.effective_from,
        last.timezone,
        last.effective_from,
        hasRecords,
        captured,
      );
      if (next.effective_from === last.effective_from) {
        // Somente uma configuração ainda sem histórico pode ser ajustada no mesmo dia.
        await tx.planos_pratica.update({
          where: { id: Number(last.id) },
          data: planData(next),
        });
      } else {
        await tx.planos_pratica.update({
          where: { id: Number(last.id) },
          data: {
            effective_until: new Date(`${next.effective_from}T00:00:00Z`),
          },
        });
        await tx.planos_pratica.create({
          data: { ...planData(next), acompanhamento_id: tracker.id },
        });
      }
      return response(
        await tx.acompanhamentos.update({
          where: { id: tracker.id },
          data,
          include,
        }),
      );
    });
  }
  async delete(user: UserRecord, id: number): Promise<void> {
    const tracker = await this.findOwned(user, id);
    await this.prisma.acompanhamentos.delete({ where: { id: tracker.id } });
  }
  async recordOccurrence(
    user: UserRecord,
    id: number,
    payload: PracticeRecordPayload = {},
  ) {
    const tracker = await this.findOwned(user, id);
    const occurred = eventTimestamp(payload.occurred_at);
    const recorded =
      payload.recorded_at === undefined
        ? undefined
        : eventTimestamp(payload.recorded_at);
    if (recorded && recorded < occurred)
      throw new BadRequestException(
        "O registro não pode ser anterior à ocorrência.",
      );
    const note = optionalText(payload.note, "Observação inválida.");
    if (note && note.length > 2000)
      throw new BadRequestException("Observação deve ter até 2000 caracteres.");
    const intent = (tracker.intent ?? "registro_livre") as PracticeIntent;
    const kind =
      payload.kind ?? (intent === "repetir" ? "atividade" : "ocorrencia");
    if (
      !["atividade", "ocorrencia", "confirmacao"].includes(String(kind)) ||
      (intent === "registro_livre" && kind !== "ocorrencia") ||
      (intent === "repetir" && kind !== "atividade") ||
      (["reduzir", "evitar"].includes(intent) && kind === "atividade")
    )
      throw new BadRequestException(
        "Tipo de registro inválido para esta intenção.",
      );
    const amount = practiceAmount(payload.amount);
    if (kind === "confirmacao" && amount !== null)
      throw new BadRequestException(
        "Confirmar o período não cria uma quantidade.",
      );
    const makeRecord = (unit?: string | null) => ({
      acompanhamento_id: tracker.id,
      occurred_at: occurred,
      ...(recorded ? { recorded_at: recorded } : {}),
      ...(payload.kind !== undefined || intent !== "registro_livre"
        ? { kind: String(kind) }
        : {}),
      ...(amount !== null ? { amount, unit: unit ?? null } : {}),
      ...(note ? { note } : {}),
    });
    if (intent === "registro_livre") {
      const unit = optionalText(payload.unit, "Unidade inválida.");
      if (unit && (unit.length > 40 || amount === null))
        throw new BadRequestException(
          "A unidade deve acompanhar uma quantidade e ter até 40 caracteres.",
        );
      const result = await this.prisma.ocorrencias_acompanhamento.create({
        data: makeRecord(unit),
      });
      return {
        ...result,
        amount: result.amount == null ? null : Number(result.amount),
      };
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM acompanhamentos WHERE id = ${tracker.id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
      const current = await tx.acompanhamentos.findFirstOrThrow({
        where: { id: tracker.id, usuario_id: user.usuario_id },
        include: { planos: { orderBy: { effective_from: "asc" } } },
      });
      const plans = current.planos.map(practicePlanResponse);
      const plan = planOn(plans, practiceDate(occurred, plans[0]?.timezone));
      if (!plan)
        throw new BadRequestException(
          "A data do registro é anterior ao início da prática.",
        );
      if (
        (payload.plan_effective_from !== undefined &&
          payload.plan_effective_from !== plan.effective_from) ||
        (payload.unit !== undefined && payload.unit !== plan.unit) ||
        (payload.plan_signature !== undefined &&
          payload.plan_signature !== practicePlanSignature(plan))
      )
        throw new HttpException(
          "O plano mudou. Revise a data e a unidade deste registro antes de tentar novamente.",
          HttpStatus.CONFLICT,
        );
      if (kind === "confirmacao") {
        const day = practiceDate(occurred, plan.timezone);
        const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
        const end =
          plan.frequency === "semanal"
            ? addPracticeDays(day, 6 - weekday)
            : day;
        if (end >= practiceDate(recorded ?? new Date(), plan.timezone))
          throw new BadRequestException(
            "Confirme somente um período já encerrado e observado por inteiro.",
          );
      }
      if (
        plan.target_amount != null &&
        kind !== "confirmacao" &&
        amount == null
      )
        throw new BadRequestException("Informe a quantidade registrada.");
      if (plan.target_amount == null && amount !== null)
        throw new BadRequestException(
          "Esta prática usa registros qualitativos, sem quantidade.",
        );
      const result = await tx.ocorrencias_acompanhamento.create({
        data: makeRecord(plan.unit),
      });
      return {
        ...result,
        amount: result.amount == null ? null : Number(result.amount),
      };
    });
  }
  async deleteOccurrence(
    user: UserRecord,
    id: number,
    occurrenceId: number,
  ): Promise<void> {
    const tracker = await this.findOwned(user, id);
    const deleted = await this.prisma.ocorrencias_acompanhamento.deleteMany({
      where: {
        id: positiveInt(occurrenceId, "Ocorrência não encontrada."),
        acompanhamento_id: tracker.id,
      },
    });
    if (!deleted.count)
      throw new HttpException(
        "Ocorrência não encontrada.",
        HttpStatus.NOT_FOUND,
      );
  }
  private async ensureGoalOwner(user: UserRecord, goalId: number) {
    if (
      !(await this.prisma.objetivos.findFirst({
        where: { id: goalId, usuario_id: user.usuario_id },
        select: { id: true },
      }))
    )
      throw new HttpException("Objetivo não encontrado.", HttpStatus.NOT_FOUND);
  }
  private async findOwned(user: UserRecord, id: number) {
    const tracker = await this.prisma.acompanhamentos.findFirst({
      where: {
        id: positiveInt(id, "Acompanhamento não encontrado."),
        usuario_id: user.usuario_id,
      },
      include,
    });
    if (!tracker)
      throw new HttpException(
        "Acompanhamento não encontrado.",
        HttpStatus.NOT_FOUND,
      );
    return tracker;
  }
}
