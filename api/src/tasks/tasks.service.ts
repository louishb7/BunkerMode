import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, series_recorrencia } from "@prisma/client";

import { GOAL_STATUS } from "../goals/goals.types";
import { UserRecord } from "../auth/auth.types";
import { OperationalCalendarService } from "../calendar/operational-calendar.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_PRIORITY,
  canReopenTask,
  TASK_INSTRUCTION_MAX_LENGTH,
  TASK_STATUS,
  TaskPriority,
  TaskRecord,
  TaskRecurrencePolicy,
} from "./task.types";

type CreateTaskPayload = {
  titulo?: unknown;
  prioridade?: unknown;
  prazo?: unknown;
  instrucao?: unknown;
  responsavel_id?: unknown;
  objetivo_id?: unknown;
  recurrence_weekdays?: unknown;
  recurrence_end_date?: unknown;
  duration_type?: unknown;
};

type UpdateTaskPayload = Partial<
  Pick<
    CreateTaskPayload,
    "titulo" | "instrucao" | "prioridade" | "prazo" | "objetivo_id"
  >
> & {
  status?: unknown;
};

const RECURRENCE_WINDOW_DAYS = 14;

function text(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  return normalized;
}

function optionalText(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpException("Campo textual inválido.", HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new HttpException(
      "Instrução excede o limite permitido.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return normalized;
}

function optionalId(value: unknown, message: string): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }
  return value;
}

function priority(value: unknown): TaskPriority {
  if (value === null || value === undefined) {
    return DEFAULT_PRIORITY;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 3
  ) {
    throw new HttpException("Prioridade inválida.", HttpStatus.BAD_REQUEST);
  }
  return value as TaskPriority;
}

function dateFromPayload(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpException("Data inválida.", HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim();
  const parts = normalized.includes("-") ? normalized.split("-") : [];
  const isoParts = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? parts.map(Number)
    : /^\d{2}-\d{2}-\d{4}$/.test(normalized)
      ? [Number(parts[2]), Number(parts[1]), Number(parts[0])]
      : null;
  if (!isoParts) {
    throw new HttpException("Data inválida.", HttpStatus.BAD_REQUEST);
  }
  const [year, month, day] = isoParts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpException("Data inválida.", HttpStatus.BAD_REQUEST);
  }
  return date;
}

function isoDateFromDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function startOfIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function statusFromPayload(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpException("Status inválido.", HttpStatus.BAD_REQUEST);
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === TASK_STATUS.pending) {
    return TASK_STATUS.pending;
  }
  throw new HttpException(
    "Use concluir para registrar a conclusão.",
    HttpStatus.BAD_REQUEST,
  );
}

function recurrenceWeekdays(value: unknown): number[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpException(
      "Frequência semanal da tarefa deve ser uma lista.",
      HttpStatus.BAD_REQUEST,
    );
  }
  const normalized: number[] = [];
  for (const weekday of value) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new HttpException(
        "Dias da frequência semanal devem estar entre 0 e 6.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!normalized.includes(weekday)) {
      normalized.push(weekday);
    }
  }
  return normalized.sort((left, right) => left - right);
}

function recurrenceTerminationPolicy(
  value: unknown,
  weekdays: number[],
): TaskRecurrencePolicy | null {
  if (value === "pontual") {
    return null;
  }

  let policy: TaskRecurrencePolicy | null = null;
  if (value === null || value === undefined || value === "") {
    policy = weekdays.length > 0 ? "sem_termino" : null;
  } else if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "sem_termino") {
      policy = "sem_termino";
    } else if (normalized === "ate_data") {
      policy = "ate_data";
    } else if (normalized === "ate_objetivo") {
      policy = "ate_objetivo";
    } else if (normalized === "pontual") {
      return null;
    } else {
      throw new HttpException(
        "Política de término da recorrência é inválida.",
        HttpStatus.BAD_REQUEST,
      );
    }
  } else {
    throw new HttpException(
      "Política de término da recorrência é inválida.",
      HttpStatus.BAD_REQUEST,
    );
  }

  if (policy !== null && weekdays.length === 0) {
    throw new HttpException(
      "Informe ao menos um dia da frequência semanal.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return policy;
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function weekdayFor(value: Date): number {
  return (value.getUTCDay() + 6) % 7;
}

function datesForRecurrence(
  start: Date,
  end: Date,
  weekdays: number[],
): Date[] {
  const dates: Date[] = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    if (weekdays.includes(weekdayFor(cursor))) {
      dates.push(new Date(cursor));
    }
  }
  return dates;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: OperationalCalendarService,
  ) {}

  async listForTasksBoard(user: UserRecord): Promise<TaskRecord[]> {
    return this.listAllForUser(user);
  }

  async materializeRecurrences(user: UserRecord): Promise<void> {
    await this.materializeSeriesRecurrences(user);
  }

  async listAllForUser(user: UserRecord): Promise<TaskRecord[]> {
    return this.prisma.missoes.findMany({
      where: { responsavel_id: user.usuario_id },
      include: { serie_recorrencia: true },
      orderBy: [
        { is_pinned: "desc" },
        { status: "asc" },
        { prazo: "asc" },
        { missao_id: "asc" },
      ],
    });
  }

  async listHistorical(user: UserRecord): Promise<TaskRecord[]> {
    const tasks = await this.listAllForUser(user);
    const today = this.today(user);
    return tasks.filter(
      (task) =>
        task.status === TASK_STATUS.completed ||
        (task.status === TASK_STATUS.pending &&
          task.prazo !== null &&
          task.prazo.toISOString().slice(0, 10) < today),
    );
  }

  async create(
    payload: CreateTaskPayload,
    user: UserRecord,
  ): Promise<TaskRecord> {
    const title = text(payload.titulo, "Título da tarefa é obrigatório.");
    const instruction = optionalText(
      payload.instrucao,
      TASK_INSTRUCTION_MAX_LENGTH,
    );
    const weekdays = recurrenceWeekdays(payload.recurrence_weekdays);
    const recurrencePolicy = recurrenceTerminationPolicy(
      payload.duration_type,
      weekdays,
    );
    const recurrenceEndDate = dateFromPayload(payload.recurrence_end_date);
    const objetivoId = optionalId(
      payload.objetivo_id,
      "Objetivo vinculado não encontrado.",
    );
    const responsavelId =
      optionalId(payload.responsavel_id, "Responsável inválido.") ??
      user.usuario_id;
    if (responsavelId !== user.usuario_id) {
      throw new HttpException("Responsável inválido.", HttpStatus.BAD_REQUEST);
    }

    const dueDate =
      dateFromPayload(payload.prazo) ?? startOfIsoDate(this.today(user));
    if (recurrencePolicy !== null) {
      if (recurrencePolicy === "ate_data" && recurrenceEndDate === null) {
        throw new HttpException(
          "Informe a data final da recorrência.",
          HttpStatus.BAD_REQUEST,
        );
      }
      if (recurrencePolicy === "ate_objetivo" && objetivoId === null) {
        throw new HttpException(
          "Recorrência até o objetivo exige um Objetivo vinculado.",
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.ensureActiveGoal(user, objetivoId);

      const endDate =
        recurrencePolicy === "ate_data" ? recurrenceEndDate : null;
      const dates = this.recurrenceDates(dueDate, endDate, weekdays);
      if (dates.length === 0) {
        throw new HttpException(
          "A frequência semanal não gera tarefas dentro da janela permitida.",
          HttpStatus.BAD_REQUEST,
        );
      }

      return this.prisma.$transaction(async (tx) => {
        const series = await tx.series_recorrencia.create({
          data: {
            responsavel_id: responsavelId,
            objetivo_id: objetivoId,
            titulo: title,
            instrucao: instruction,
            prioridade: priority(payload.prioridade),
            recurrence_weekdays: weekdays,
            start_date: dueDate,
            termination_policy: recurrencePolicy,
            end_date: endDate,
            ativo: true,
          },
        });
        const created = await this.createSeriesOccurrences(
          tx,
          series,
          dates,
          user.usuario_id,
        );
        const firstTask = this.firstTask(created);
        if (!firstTask) {
          throw new HttpException(
            "A frequência semanal não gera novas tarefas dentro da janela permitida.",
            HttpStatus.BAD_REQUEST,
          );
        }
        return { ...firstTask, serie_recorrencia: series };
      });
    }

    await this.ensureActiveGoal(user, objetivoId);

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.missoes.create({
        data: {
          titulo: title,
          prioridade: priority(payload.prioridade),
          prazo: dueDate,
          instrucao: instruction,
          status: TASK_STATUS.pending,
          objetivo_id: objetivoId,
          recurrence_series_id: null,
          criada_por_id: user.usuario_id,
          responsavel_id: responsavelId,
        },
      });
      await tx.auditoria_eventos.create({
        data: {
          missao_id: task.missao_id,
          usuario_id: user.usuario_id,
          acao: "tarefa_criada",
          detalhes: `Tarefa '${task.titulo}' criada.`,
        },
      });
      return task;
    });

    return created;
  }

  async listDailyOperational(user: UserRecord): Promise<TaskRecord[]> {
    const today = this.today(user);
    const day = startOfIsoDate(today);
    // A janela de três dias cobre qualquer fuso operacional; o filtro abaixo
    // mantém a mesma regra exata para o dia local do usuário.
    const tasks = await this.prisma.missoes.findMany({
      where: {
        responsavel_id: user.usuario_id,
        OR: [
          { prazo: day },
          { completed_at: { gte: addDays(day, -1), lt: addDays(day, 2) } },
        ],
      },
      include: { serie_recorrencia: true },
    });
    return this.sortForBoard(
      tasks.filter((task) =>
        this.belongsToOperationalDate(task, today, user.timezone),
      ),
    );
  }

  async focusBoard(user: UserRecord): Promise<{
    action_tasks: TaskRecord[];
    daily_tasks: TaskRecord[];
  }> {
    const today = this.today(user);
    const tasks = await this.listAllForUser(user);
    const todayTasks = this.sortForBoard(
      tasks.filter((task) =>
        this.belongsToOperationalDate(task, today, user.timezone),
      ),
    );
    const actionTasks = this.sortForBoard(
      todayTasks.filter((task) => this.visibleInFocus(task, today)),
    );

    return {
      daily_tasks: todayTasks,
      action_tasks: actionTasks,
    };
  }

  async update(
    id: number,
    payload: UpdateTaskPayload,
    user: UserRecord,
  ): Promise<TaskRecord> {
    const current = await this.getTaskForUser(id, user);
    if (
      ["recurrence_weekdays", "recurrence_end_date", "duration_type"].some(
        (key) => Object.prototype.hasOwnProperty.call(payload, key),
      )
    ) {
      throw new HttpException(
        "A recorrência é definida na criação da tarefa. A edição altera somente esta tarefa.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (current.status !== TASK_STATUS.pending) {
      throw new HttpException(
        "Apenas tarefa pendente pode ser editada.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "prazo")) {
      const requestedDueDate = dateFromPayload(payload.prazo);
      if (
        current.recurrence_series_id !== null &&
        requestedDueDate?.getTime() !== current.prazo?.getTime()
      ) {
        throw new HttpException(
          "Esta tarefa pertence a uma série recorrente. Reagendamento individual ainda não é suportado.",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const hasObjetivoId = Object.prototype.hasOwnProperty.call(
      payload,
      "objetivo_id",
    );
    if (hasObjetivoId && current.recurrence_series_id !== null) {
      throw new HttpException(
        "Use o desvínculo da série para alterar o Objetivo de uma tarefa recorrente.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const objetivoId = hasObjetivoId
      ? optionalId(payload.objetivo_id, "Objetivo vinculado não encontrado.")
      : current.objetivo_id;
    if (objetivoId !== null && objetivoId !== current.objetivo_id) {
      await this.ensureActiveGoal(user, objetivoId);
    }

    const data: Prisma.missoesUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(payload, "titulo")) {
      data.titulo = text(payload.titulo, "Título da tarefa é obrigatório.");
    }
    if (Object.prototype.hasOwnProperty.call(payload, "instrucao")) {
      data.instrucao = optionalText(
        payload.instrucao,
        TASK_INSTRUCTION_MAX_LENGTH,
      );
    }
    if (Object.prototype.hasOwnProperty.call(payload, "prioridade")) {
      data.prioridade = priority(payload.prioridade);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "prazo")) {
      data.prazo = dateFromPayload(payload.prazo);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "status")) {
      const status = statusFromPayload(payload.status);
      if (status === TASK_STATUS.pending) {
        data.status = TASK_STATUS.pending;
        data.completed_at = null;
      }
    }
    if (hasObjetivoId) {
      data.objetivos =
        objetivoId === null
          ? { disconnect: true }
          : { connect: { id: objetivoId } };
    }

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.missoes.update({
        where: { missao_id: id },
        data,
        include: { serie_recorrencia: true },
      });
      await tx.auditoria_eventos.create({
        data: {
          missao_id: id,
          usuario_id: user.usuario_id,
          acao: "tarefa_atualizada",
          detalhes: `Tarefa '${task.titulo}' atualizada.`,
        },
      });
      return task;
    });
  }

  async complete(id: number, user: UserRecord): Promise<TaskRecord> {
    const current = await this.getTaskForUser(id, user);
    if (
      current.status !== TASK_STATUS.pending ||
      current.completed_at !== null
    ) {
      throw new HttpException(
        "Tarefa não pode ser concluída neste estado.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const now = new Date();
    return this.updateExecutionState(id, user, {
      data: {
        status: TASK_STATUS.completed,
        completed_at: now,
      },
      action: "tarefa_concluida",
      details: `Tarefa '${current.titulo}' concluída.`,
    });
  }

  async linkToObjective(id: number, user: UserRecord, value: unknown) {
    const current = await this.getTaskForUser(id, user);
    const goalId = optionalId(value, "Objetivo vinculado não encontrado.");
    if (goalId === null)
      throw new HttpException("Informe um objetivo.", HttpStatus.BAD_REQUEST);
    await this.ensureActiveGoal(user, goalId);
    if (current.objetivo_id !== null && current.objetivo_id !== goalId)
      throw new HttpException(
        "Desvincule a tarefa do objetivo atual antes de vinculá-la a outro.",
        HttpStatus.CONFLICT,
      );
    await this.prisma.$transaction(async (tx) => {
      if (current.recurrence_series_id !== null) {
        const series = await tx.series_recorrencia.findFirst({
          where: {
            recurrence_series_id: current.recurrence_series_id,
            responsavel_id: user.usuario_id,
          },
        });
        if (!series)
          throw new HttpException(
            "Série recorrente não encontrada.",
            HttpStatus.NOT_FOUND,
          );
        await tx.series_recorrencia.update({
          where: { recurrence_series_id: series.recurrence_series_id },
          data: { objetivo_id: goalId },
        });
        await tx.missoes.updateMany({
          where: {
            recurrence_series_id: series.recurrence_series_id,
            responsavel_id: user.usuario_id,
          },
          data: { objetivo_id: goalId },
        });
      } else {
        await tx.missoes.update({
          where: { missao_id: current.missao_id },
          data: { objetivo_id: goalId },
        });
      }
    });
    return {
      tarefa_id: current.missao_id,
      series_id: current.recurrence_series_id,
      objetivo_id: goalId,
    };
  }

  async unlinkFromObjective(
    id: number,
    user: UserRecord,
  ): Promise<{
    tarefa_id: number;
    series_id: number | null;
    objetivo_id: null;
  }> {
    const current = await this.getTaskForUser(id, user);
    if (current.objetivo_id === null) {
      throw new HttpException(
        "Tarefa não está vinculada a um objetivo.",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (current.recurrence_series_id === null) {
      await this.prisma.missoes.update({
        where: { missao_id: current.missao_id },
        data: { objetivo_id: null },
      });
      return {
        tarefa_id: current.missao_id,
        series_id: null,
        objetivo_id: null,
      };
    }

    const series = await this.prisma.series_recorrencia.findFirst({
      where: {
        recurrence_series_id: current.recurrence_series_id,
        responsavel_id: user.usuario_id,
      },
    });
    if (!series) {
      throw new HttpException(
        "Série recorrente não encontrada.",
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.series_recorrencia.update({
        where: { recurrence_series_id: series.recurrence_series_id },
        data: {
          objetivo_id: null,
          ...(series.termination_policy === "ate_objetivo"
            ? { termination_policy: "sem_termino" }
            : {}),
        },
      });
      await tx.missoes.updateMany({
        where: {
          recurrence_series_id: series.recurrence_series_id,
          responsavel_id: user.usuario_id,
        },
        data: { objetivo_id: null },
      });
    });
    return {
      tarefa_id: current.missao_id,
      series_id: series.recurrence_series_id,
      objetivo_id: null,
    };
  }

  async reopen(id: number, user: UserRecord): Promise<TaskRecord> {
    const current = await this.getTaskForUser(id, user);
    if (!canReopenTask(current, user)) {
      throw new HttpException(
        "Apenas tarefa finalizada pode ser reaberta.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.updateExecutionState(id, user, {
      data: { status: TASK_STATUS.pending, completed_at: null },
      action: "tarefa_reaberta",
      details: `Tarefa '${current.titulo}' reaberta.`,
    });
  }

  async togglePin(id: number, user: UserRecord): Promise<TaskRecord> {
    const current = await this.getTaskForUser(id, user);
    if (current.status !== TASK_STATUS.pending) {
      throw new HttpException(
        "Prioridade disponível apenas para tarefas pendentes.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const pinned = !current.is_pinned;
    return this.updateExecutionState(id, user, {
      data: { is_pinned: pinned },
      action: pinned
        ? "tarefa_prioridade_fixada"
        : "tarefa_prioridade_removida",
      details: pinned
        ? "O usuário fixou a tarefa no topo do dia."
        : "O usuário removeu a tarefa do topo do dia.",
    });
  }

  async delete(id: number, user: UserRecord): Promise<void> {
    const current = await this.getTaskForUser(id, user);
    if (current.recurrence_series_id !== null) {
      throw new HttpException(
        "Esta tarefa pertence a uma série recorrente. Exclusão individual ainda não é suportada.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (current.status !== TASK_STATUS.pending) {
      throw new HttpException(
        "Apenas tarefa pendente pode ser removida. Resultados ficam no histórico.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.auditoria_eventos.deleteMany({ where: { missao_id: id } });
      await tx.missoes.delete({ where: { missao_id: id } });
      await tx.auditoria_eventos.create({
        data: {
          missao_id: null,
          usuario_id: user.usuario_id,
          acao: "tarefa_removida",
          detalhes: `Tarefa '${current.titulo}' removida.`,
        },
      });
    });
  }

  async taskHistory(id: number, user: UserRecord) {
    await this.getTaskForUser(id, user);
    return this.prisma.auditoria_eventos.findMany({
      where: { missao_id: id },
      orderBy: [{ criado_em: "asc" }, { evento_id: "asc" }],
    });
  }

  private async getTaskForUser(
    id: number,
    user: UserRecord,
  ): Promise<TaskRecord> {
    const task = await this.prisma.missoes.findFirst({
      where: {
        missao_id: id,
        responsavel_id: user.usuario_id,
      },
    });
    if (!task) {
      throw new HttpException(
        `Tarefa ${id} não encontrada`,
        HttpStatus.NOT_FOUND,
      );
    }
    return task;
  }

  private async materializeSeriesRecurrences(user: UserRecord): Promise<void> {
    const today = startOfIsoDate(this.today(user));
    const windowEnd = addDays(today, RECURRENCE_WINDOW_DAYS - 1);
    const seriesList = await this.prisma.series_recorrencia.findMany({
      where: {
        responsavel_id: user.usuario_id,
        ativo: true,
      },
      include: { objetivos: true },
    });
    if (seriesList.length === 0) {
      return;
    }

    const existing = await this.prisma.missoes.findMany({
      where: {
        recurrence_series_id: {
          in: seriesList.map((series) => series.recurrence_series_id),
        },
        prazo: { gte: today, lte: windowEnd },
      },
      select: { recurrence_series_id: true, prazo: true },
    });
    const existingDates = new Set(
      existing.map(
        (task) => `${task.recurrence_series_id}:${isoDateFromDate(task.prazo)}`,
      ),
    );

    const missingBySeries: Array<{
      series: series_recorrencia;
      dates: Date[];
    }> = [];
    const inactiveIds: number[] = [];
    for (const series of seriesList) {
      if (series.termination_policy === "ate_objetivo") {
        if (series.objetivo_id === null || series.objetivos === null) {
          inactiveIds.push(series.recurrence_series_id);
          continue;
        }
        if (series.objetivos.status !== GOAL_STATUS.active) {
          continue;
        }
      }

      const start = series.start_date > today ? series.start_date : today;
      const limit =
        series.termination_policy === "ate_data" &&
        series.end_date &&
        series.end_date < windowEnd
          ? series.end_date
          : windowEnd;
      if (limit < start) {
        continue;
      }

      const dates = datesForRecurrence(
        start,
        limit,
        series.recurrence_weekdays,
      );
      const missing = dates.filter(
        (date) =>
          !existingDates.has(
            `${series.recurrence_series_id}:${isoDateFromDate(date)}`,
          ),
      );
      if (missing.length > 0) missingBySeries.push({ series, dates: missing });
    }
    if (missingBySeries.length === 0 && inactiveIds.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      if (inactiveIds.length > 0) {
        await tx.series_recorrencia.updateMany({
          where: { recurrence_series_id: { in: inactiveIds }, ativo: true },
          data: { ativo: false },
        });
      }
      for (const { series, dates } of missingBySeries) {
        await this.createSeriesOccurrences(tx, series, dates, user.usuario_id);
      }
    });
  }

  private async createSeriesOccurrences(
    tx: Prisma.TransactionClient,
    series: series_recorrencia,
    dates: Date[],
    auditUserId: number,
  ): Promise<TaskRecord[]> {
    if (dates.length === 0) {
      return [];
    }

    const created = await tx.missoes.createManyAndReturn({
      data: dates.map((date) => ({
        titulo: series.titulo,
        prioridade: series.prioridade,
        prazo: date,
        instrucao: series.instrucao,
        status: TASK_STATUS.pending,
        objetivo_id: series.objetivo_id,
        recurrence_series_id: series.recurrence_series_id,
        criada_por_id: series.responsavel_id,
        responsavel_id: series.responsavel_id,
      })),
      skipDuplicates: true,
    });

    if (created.length > 0) {
      await tx.auditoria_eventos.createMany({
        data: created.map((task) => ({
          missao_id: task.missao_id,
          usuario_id: auditUserId,
          acao: "tarefa_recorrente_criada",
          detalhes: `Recorrência gerou a tarefa '${task.titulo}'.`,
        })),
      });
    }
    return created;
  }

  private firstTask(tasks: TaskRecord[]): TaskRecord | null {
    return (
      [...tasks].sort((left, right) => {
        const leftDate = left.prazo?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightDate = right.prazo?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftDate - rightDate || left.missao_id - right.missao_id;
      })[0] ?? null
    );
  }

  private async ensureActiveGoal(
    user: UserRecord,
    objetivoId: number | null,
  ): Promise<void> {
    if (objetivoId === null) {
      return;
    }
    const objetivo = await this.prisma.objetivos.findFirst({
      where: {
        id: objetivoId,
        usuario_id: user.usuario_id,
        status: GOAL_STATUS.active,
      },
    });
    if (!objetivo) {
      throw new HttpException(
        "Objetivo vinculado não está ativo.",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async updateExecutionState(
    id: number,
    user: UserRecord,
    options: {
      data: Prisma.missoesUpdateInput;
      action: string;
      details: string;
    },
  ): Promise<TaskRecord> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.missoes.update({
        where: { missao_id: id },
        data: options.data,
        include: { serie_recorrencia: true },
      });
      await tx.auditoria_eventos.create({
        data: {
          missao_id: id,
          usuario_id: user.usuario_id,
          acao: options.action,
          detalhes: options.details,
        },
      });
      return task;
    });
  }

  private today(user: UserRecord): string {
    return this.calendar.currentDateFor(new Date(), user.timezone);
  }

  private belongsToOperationalDate(
    task: TaskRecord,
    isoDate: string,
    timezone: string,
  ): boolean {
    if (isoDateFromDate(task.prazo) === isoDate) {
      return true;
    }
    const eventDate = task.completed_at;
    return (
      eventDate !== null &&
      this.calendar.currentDateFor(eventDate, timezone) === isoDate
    );
  }

  private visibleInFocus(task: TaskRecord, isoDate: string): boolean {
    return (
      task.status === TASK_STATUS.pending &&
      isoDateFromDate(task.prazo) === isoDate
    );
  }

  private sortForBoard(tasks: TaskRecord[]): TaskRecord[] {
    return [...tasks].sort((left, right) => {
      const pinned = Number(right.is_pinned) - Number(left.is_pinned);
      if (pinned !== 0) {
        return pinned;
      }
      const finalized =
        Number(left.status !== TASK_STATUS.pending) -
        Number(right.status !== TASK_STATUS.pending);
      if (finalized !== 0) {
        return finalized;
      }
      const leftDate = left.prazo ?? startOfIsoDate("9999-12-31");
      const rightDate = right.prazo ?? startOfIsoDate("9999-12-31");
      const dateDiff = leftDate.getTime() - rightDate.getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return left.missao_id - right.missao_id;
    });
  }

  private recurrenceDates(
    start: Date,
    recurrenceEndDate: Date | null,
    weekdays: number[],
  ): Date[] {
    const defaultLimit = addDays(start, RECURRENCE_WINDOW_DAYS - 1);
    const limit =
      recurrenceEndDate && recurrenceEndDate < defaultLimit
        ? recurrenceEndDate
        : defaultLimit;
    if (limit < start) {
      throw new HttpException(
        "Prazo da recorrência não pode ser anterior à data inicial.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return datesForRecurrence(start, limit, weekdays);
  }
}
