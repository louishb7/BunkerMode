import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UserRecord } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { toTaskResponse } from "../tasks/task-response";
import { GoalsService } from "../goals/goals.service";
import { TrackersService } from "../goals/trackers.service";
import { FinancesService } from "../finances/finances.service";

type Operation = {
  operationId: string;
  domain: "task" | "goal" | "tracker" | "occurrence" | "entry";
  action: string;
  target?: number;
  parentId?: number;
  payload?: Record<string, unknown>;
  baseUpdatedAt?: string;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed: Record<Operation["domain"], string[]> = {
  task: [
    "create",
    "update",
    "complete",
    "reopen",
    "pin",
    "delete",
    "link",
    "unlink",
  ],
  goal: ["create", "update", "status", "delete"],
  tracker: ["create", "update", "delete"],
  occurrence: ["create", "delete"],
  entry: ["create"],
};
const payloadFields: Record<Operation["domain"], string[]> = {
  task: [
    "titulo",
    "instrucao",
    "prioridade",
    "prazo",
    "responsavel_id",
    "objetivo_id",
    "recurrence_weekdays",
    "recurrence_end_date",
    "duration_type",
    "is_pinned",
    "occurred_at",
  ],
  goal: ["titulo", "descricao", "data_alvo", "status"],
  tracker: ["titulo", "descricao", "objetivo_id", "intent", "plan", "status", "effective_from", "recorded_at"],
  occurrence: ["occurred_at", "recorded_at", "kind", "amount", "note", "plan_effective_from", "unit", "plan_signature"],
  entry: ["titulo", "tipo", "valor_centavos", "data"],
};

function parseOperation(raw: unknown): Operation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestException("Operação inválida.");
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "operationId",
          "domain",
          "action",
          "target",
          "parentId",
          "payload",
          "baseUpdatedAt",
        ].includes(key),
    ) ||
    typeof value.operationId !== "string" ||
    !uuid.test(value.operationId) ||
    typeof value.domain !== "string" ||
    !Object.hasOwn(allowed, value.domain) ||
    typeof value.action !== "string" ||
    !allowed[value.domain as Operation["domain"]].includes(value.action) ||
    (value.target !== undefined &&
      (!Number.isSafeInteger(value.target) || Number(value.target) < 1)) ||
    (value.parentId !== undefined &&
      (!Number.isSafeInteger(value.parentId) || Number(value.parentId) < 1)) ||
    (value.payload !== undefined &&
      (!value.payload ||
        typeof value.payload !== "object" ||
        Array.isArray(value.payload))) ||
    (value.baseUpdatedAt !== undefined &&
      (typeof value.baseUpdatedAt !== "string" ||
        !Number.isFinite(Date.parse(value.baseUpdatedAt))))
  )
    throw new BadRequestException("Operação inválida.");
  const operation = value as Operation;
  // Lançamentos selecionam somente os campos ativos no serviço; o payload original
  // mantém a identidade das operações enviadas antes da remoção de campos históricos.
  if (
    operation.payload &&
    operation.domain !== "entry" &&
    Object.keys(operation.payload).some(
      (key) => !payloadFields[operation.domain].includes(key),
    )
  )
    throw new BadRequestException("Campos não permitidos na operação.");
  if (operation.action !== "create" && operation.target === undefined)
    throw new BadRequestException("Alvo da operação ausente.");
  if (
    operation.action === "create" &&
    operation.domain === "occurrence" &&
    operation.parentId === undefined
  )
    throw new BadRequestException("Acompanhamento ausente.");
  if (
    operation.action !== "create" &&
    operation.baseUpdatedAt === undefined &&
    operation.domain !== "occurrence"
  )
    throw new BadRequestException("Versão base ausente.");
  return operation;
}

@Injectable()
export class OfflineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly goals: GoalsService,
    private readonly trackers: TrackersService,
    private readonly finances: FinancesService,
  ) {}

  async execute(user: UserRecord, raw: unknown) {
    const op = parseOperation(raw);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(op))
      .digest("hex");
    return this.prisma.withOperationTransaction(async (tx) => {
      // The lock serializes identical operation IDs across tabs/devices. The row and
      // domain mutation commit together; a lost HTTP response can safely be replayed.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(user.usuario_id)}), hashtext(${op.operationId}))::text AS locked`;
      const prior = await tx.offlineOperation.findUnique({
        where: {
          userId_operationId: {
            userId: user.usuario_id,
            operationId: op.operationId,
          },
        },
      });
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new ConflictException("Identidade da operação reutilizada.");
        return prior.result;
      }
      await this.assertVersion(tx, user, op);
      const result = await this.apply(user, op, tx);
      const persisted = JSON.parse(
        JSON.stringify(result),
      ) as Prisma.InputJsonValue;
      await tx.offlineOperation.create({
        data: {
          userId: user.usuario_id,
          operationId: op.operationId,
          requestHash,
          result: persisted,
        },
      });
      return persisted;
    });
  }

  private async assertVersion(
    tx: Prisma.TransactionClient,
    user: UserRecord,
    op: Operation,
  ) {
    if (op.action === "create" || op.domain === "occurrence") return;
    const id = op.target!;
    // Lock the existing row before comparing its version. Two different offline
    // operation IDs targeting one record cannot both pass the same base version.
    if (op.domain === "task")
      await tx.$queryRaw`SELECT missao_id FROM missoes WHERE missao_id = ${id} AND responsavel_id = ${user.usuario_id} FOR UPDATE`;
    else if (op.domain === "goal")
      await tx.$queryRaw`SELECT id FROM objetivos WHERE id = ${id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM acompanhamentos WHERE id = ${id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
    const row =
      op.domain === "task"
        ? await tx.missoes.findFirst({
            where: { missao_id: id, responsavel_id: user.usuario_id },
            select: { updated_at: true },
          })
        : op.domain === "goal"
          ? await tx.objetivos.findFirst({
              where: { id, usuario_id: user.usuario_id },
              select: { updated_at: true },
            })
          : await tx.acompanhamentos.findFirst({
              where: { id, usuario_id: user.usuario_id },
              select: { updated_at: true },
            });
    if (!row) throw new NotFoundException("Registro não encontrado.");
    if (row.updated_at.toISOString() !== op.baseUpdatedAt)
      throw new ConflictException(
        "O registro foi alterado em outro dispositivo.",
      );
  }

  private async apply(
    user: UserRecord,
    op: Operation,
    tx: Prisma.TransactionClient,
  ): Promise<unknown> {
    const p = op.payload ?? {};
    const id = op.target!;
    if (op.domain === "task") {
      if (op.action === "create")
        return toTaskResponse(await this.tasks.create(p, user), user);
      if (op.action === "update")
        return toTaskResponse(await this.tasks.update(id, p, user), user);
      if (op.action === "complete")
        return toTaskResponse(await this.tasks.complete(id, user, p.occurred_at), user);
      if (op.action === "reopen")
        return toTaskResponse(await this.tasks.reopen(id, user), user);
      if (op.action === "pin") {
        if (typeof p.is_pinned !== "boolean")
          throw new BadRequestException("Estado da fixação inválido.");
        const current = await tx.missoes.findFirst({
          where: { missao_id: id, responsavel_id: user.usuario_id },
          include: { serie_recorrencia: true },
        });
        if (!current) throw new NotFoundException("Tarefa não encontrada.");
        return toTaskResponse(
          current.is_pinned === p.is_pinned
            ? current
            : await this.tasks.togglePin(id, user),
          user,
        );
      }
      if (op.action === "link" || op.action === "unlink") {
        if (op.action === "link")
          await this.tasks.linkToObjective(id, user, p.objetivo_id);
        else await this.tasks.unlinkFromObjective(id, user);
        const task = await tx.missoes.findUniqueOrThrow({
          where: { missao_id: id },
          include: { serie_recorrencia: true },
        });
        return toTaskResponse(task, user);
      }
      await this.tasks.delete(id, user);
      return { deleted: true };
    }
    if (op.domain === "goal") {
      if (op.action === "create") return this.goals.create(user, p);
      if (op.action === "update") return this.goals.update(user, id, p);
      if (op.action === "status")
        return this.goals.updateStatus(user, id, p.status);
      await this.goals.delete(user, id);
      return { deleted: true };
    }
    if (op.domain === "tracker") {
      if (op.action === "create") return this.trackers.create(user, p);
      if (op.action === "update") return this.trackers.update(user, id, p);
      await this.trackers.delete(user, id);
      return { deleted: true };
    }
    if (op.domain === "occurrence") {
      if (op.action === "create")
        return this.trackers.recordOccurrence(user, op.parentId!, p);
      await this.trackers.deleteOccurrence(user, op.parentId!, id);
      return { deleted: true };
    }
    return this.finances.createEntry(user, p);
  }
}
