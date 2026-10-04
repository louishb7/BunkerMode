import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { UserRecord } from "../auth/auth.types";
import {
  optionalText,
  parseIsoDate,
  positiveInt,
  requiredText,
} from "../common/domain-helpers";
import { PrismaService } from "../prisma/prisma.service";
import { GOAL_STATUS, GoalResponse, toGoalResponse } from "./goals.types";
import { Prisma } from "@prisma/client";
import { captureAchievement } from "./achievement-snapshot";

type CreateGoalPayload = {
  titulo?: unknown;
  descricao?: unknown;
  data_alvo?: unknown;
};

type UpdateGoalPayload = {
  titulo?: unknown;
  descricao?: unknown;
  data_alvo?: unknown;
};

type GoalOrderPayload = {
  objetivo_ids?: unknown;
};

function goalStatus(value: unknown): string {
  if (
    value !== GOAL_STATUS.active &&
    value !== GOAL_STATUS.concluded &&
    value !== GOAL_STATUS.paused &&
    value !== GOAL_STATUS.abandoned
  ) {
    throw new HttpException(
      "Status de objetivo inválido.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: UserRecord): Promise<GoalResponse[]> {
    const goals = await this.prisma.objetivos.findMany({
      where: { usuario_id: user.usuario_id },
      orderBy: [{ order_index: "asc" }, { created_at: "asc" }, { id: "asc" }],
    });
    return goals.map(toGoalResponse);
  }

  async create(
    user: UserRecord,
    payload: CreateGoalPayload,
  ): Promise<GoalResponse> {
    const orderIndex = await this.nextOrderIndex(user.usuario_id);
    const now = new Date();
    const goal = await this.prisma.objetivos.create({
      data: {
        usuario_id: user.usuario_id,
        titulo: requiredText(
          payload.titulo,
          "Título do objetivo é obrigatório.",
          200,
        ),
        descricao: optionalText(
          payload.descricao,
          "Descrição do objetivo inválida.",
        ),
        data_alvo: parseIsoDate(
          payload.data_alvo,
          "Data alvo do objetivo inválida.",
        ),
        status: GOAL_STATUS.active,
        order_index: orderIndex,
        created_at: now,
        updated_at: now,
      },
    });
    return toGoalResponse(goal);
  }

  async update(
    user: UserRecord,
    goalId: number,
    payload: UpdateGoalPayload,
  ): Promise<GoalResponse> {
    const existing = await this.findOwned(user, goalId);
    const goal = await this.prisma.objetivos.update({
      where: { id: existing.id },
      data: {
        ...(payload.titulo !== undefined
          ? {
              titulo: requiredText(
                payload.titulo,
                "Título do objetivo é obrigatório.",
                200,
              ),
            }
          : {}),
        ...(payload.descricao !== undefined
          ? {
              descricao: optionalText(
                payload.descricao,
                "Descrição do objetivo inválida.",
              ),
            }
          : {}),
        ...(payload.data_alvo !== undefined
          ? {
              data_alvo: parseIsoDate(
                payload.data_alvo,
                "Data alvo do objetivo inválida.",
              ),
            }
          : {}),
        updated_at: new Date(),
      },
    });
    return toGoalResponse(goal);
  }

  async updateStatus(
    user: UserRecord,
    goalId: number,
    value: unknown,
  ): Promise<GoalResponse> {
    const status = goalStatus(value);
    if (status === GOAL_STATUS.concluded) {
      await this.conquer(user, goalId, {});
      return toGoalResponse(await this.findOwned(user, goalId));
    }
    const id = positiveInt(goalId, "Objetivo não encontrado.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM objetivos WHERE id = ${id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
      const existing = await tx.objetivos.findFirst({
        where: { id, usuario_id: user.usuario_id },
      });
      if (!existing)
        throw new HttpException(
          "Objetivo não encontrado.",
          HttpStatus.BAD_REQUEST,
        );
      if (existing.status === GOAL_STATUS.concluded) {
        throw new HttpException(
          "Este objetivo já foi conquistado. Crie uma nova direção para continuar.",
          HttpStatus.CONFLICT,
        );
      }
      return toGoalResponse(
        await tx.objetivos.update({
          where: { id },
          data: { status, concluded_at: null, updated_at: new Date() },
        }),
      );
    });
  }

  listAchievements(user: UserRecord) {
    return this.prisma.conquistas_objetivos.findMany({
      where: { usuario_id: user.usuario_id },
      orderBy: [
        { conquistado_em: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
      select: {
        id: true,
        objetivo_id: true,
        conquistado_em: true,
        nota: true,
        snapshot: true,
      },
    });
  }

  async conquer(user: UserRecord, goalId: number, payload: { nota?: unknown }) {
    const id = positiveInt(goalId, "Objetivo não encontrado.");
    const note = optionalText(payload.nota, "Nota da conquista inválida.");
    if (note && note.length > 2000)
      throw new HttpException(
        "A nota deve ter até 2000 caracteres.",
        HttpStatus.BAD_REQUEST,
      );
    // Row lock + repeatable snapshot prevent duplicate crowns and partial memories.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM objetivos WHERE id = ${id} AND usuario_id = ${user.usuario_id} FOR UPDATE`;
            const goal = await tx.objetivos.findFirst({
              where: { id, usuario_id: user.usuario_id },
            });
            if (!goal)
              throw new HttpException(
                "Objetivo não encontrado.",
                HttpStatus.BAD_REQUEST,
              );
            const prior = await tx.conquistas_objetivos.findUnique({
              where: { objetivo_id: id },
            });
            if (prior) return prior;
            const now = new Date();
            const snapshot = await captureAchievement(tx, id, user, now);
            const achievement = await tx.conquistas_objetivos.create({
              data: {
                objetivo_id: id,
                usuario_id: user.usuario_id,
                conquistado_em: now,
                nota: note,
                snapshot,
              },
            });
            await tx.objetivos.update({
              where: { id },
              data: {
                status: GOAL_STATUS.concluded,
                concluded_at: now,
                updated_at: now,
              },
            });
            return achievement;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );
      } catch (error) {
        const driverError =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? (error.meta?.driverAdapterError as
                { cause?: { originalCode?: string } } | undefined)
            : undefined;
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" ||
            (error.code === "P2010" &&
              (error.meta?.code === "40001" ||
                driverError?.cause?.originalCode === "40001")));
        if (attempt >= 2 || !serializationFailure) throw error;
      }
    }
  }

  async reorder(
    user: UserRecord,
    payload: GoalOrderPayload,
  ): Promise<GoalResponse[]> {
    if (
      !Array.isArray(payload.objetivo_ids) ||
      payload.objetivo_ids.length === 0
    ) {
      throw new HttpException(
        "Lista de objetivos contém duplicidade.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const ids = payload.objetivo_ids.map((id) =>
      positiveInt(id, "Objetivo não encontrado."),
    );
    if (new Set(ids).size !== ids.length) {
      throw new HttpException(
        "Lista de objetivos contém duplicidade.",
        HttpStatus.BAD_REQUEST,
      );
    }

    const goals = await this.prisma.objetivos.findMany({
      where: { id: { in: ids }, usuario_id: user.usuario_id },
    });
    if (goals.length !== ids.length) {
      throw new HttpException(
        "Objetivo não encontrado.",
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.objetivos.update({
          where: { id },
          data: { order_index: index + 1, updated_at: new Date() },
        }),
      ),
    );
    return this.list(user);
  }

  async delete(user: UserRecord, goalId: number): Promise<void> {
    const existing = await this.findOwned(user, goalId);
    await this.prisma.$transaction(async (tx) => {
      await tx.series_recorrencia.updateMany({
        where: {
          objetivo_id: existing.id,
          termination_policy: "ate_objetivo",
        },
        data: { ativo: false },
      });
      await tx.objetivos.delete({ where: { id: existing.id } });
    });
  }

  private async nextOrderIndex(userId: number): Promise<number> {
    const aggregate = await this.prisma.objetivos.aggregate({
      where: { usuario_id: userId },
      _max: { order_index: true },
    });
    return (aggregate._max.order_index ?? 0) + 1;
  }

  private async findOwned(user: UserRecord, goalId: number) {
    const id = positiveInt(goalId, "Objetivo não encontrado.");
    const goal = await this.prisma.objetivos.findFirst({
      where: { id, usuario_id: user.usuario_id },
    });
    if (!goal) {
      throw new HttpException(
        "Objetivo não encontrado.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return goal;
  }
}
