import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

import { UserRecord } from "../auth/auth.types";
import { optionalText, positiveInt, requiredText } from "../common/domain-helpers";
import { PrismaService } from "../prisma/prisma.service";

type TrackerPayload = { objetivo_id?: unknown; titulo?: unknown; descricao?: unknown };

@Injectable()
export class TrackersService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: UserRecord) {
    return this.prisma.acompanhamentos.findMany({
      where: { objetivo: { usuario_id: user.usuario_id } },
      include: { ocorrencias: { orderBy: [{ occurred_at: "desc" }, { id: "desc" }], take: 5 } },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
  }

  async create(user: UserRecord, payload: TrackerPayload) {
    const goalId = positiveInt(payload.objetivo_id, "Objetivo não encontrado.");
    await this.ensureGoalOwner(user, goalId);
    return this.prisma.acompanhamentos.create({
      data: {
        objetivo_id: goalId,
        titulo: requiredText(payload.titulo, "Título do acompanhamento é obrigatório.", 200),
        descricao: optionalText(payload.descricao, "Descrição do acompanhamento inválida."),
      },
      include: { ocorrencias: true },
    });
  }

  async update(user: UserRecord, id: number, payload: TrackerPayload) {
    const tracker = await this.findOwned(user, id);
    return this.prisma.acompanhamentos.update({
      where: { id: tracker.id },
      data: {
        ...(payload.titulo !== undefined
          ? { titulo: requiredText(payload.titulo, "Título do acompanhamento é obrigatório.", 200) }
          : {}),
        ...(payload.descricao !== undefined
          ? { descricao: optionalText(payload.descricao, "Descrição do acompanhamento inválida.") }
          : {}),
      },
      include: { ocorrencias: { orderBy: [{ occurred_at: "desc" }, { id: "desc" }], take: 5 } },
    });
  }

  async delete(user: UserRecord, id: number): Promise<void> {
    const tracker = await this.findOwned(user, id);
    await this.prisma.acompanhamentos.delete({ where: { id: tracker.id } });
  }

  async recordOccurrence(user: UserRecord, id: number) {
    const tracker = await this.findOwned(user, id);
    return this.prisma.ocorrencias_acompanhamento.create({
      data: { acompanhamento_id: tracker.id },
    });
  }

  async deleteOccurrence(user: UserRecord, id: number, occurrenceId: number): Promise<void> {
    const tracker = await this.findOwned(user, id);
    const deleted = await this.prisma.ocorrencias_acompanhamento.deleteMany({
      where: {
        id: positiveInt(occurrenceId, "Ocorrência não encontrada."),
        acompanhamento_id: tracker.id,
      },
    });
    if (deleted.count === 0) {
      throw new HttpException("Ocorrência não encontrada.", HttpStatus.NOT_FOUND);
    }
  }

  private async ensureGoalOwner(user: UserRecord, goalId: number) {
    const goal = await this.prisma.objetivos.findFirst({
      where: { id: goalId, usuario_id: user.usuario_id },
      select: { id: true },
    });
    if (!goal) throw new HttpException("Objetivo não encontrado.", HttpStatus.NOT_FOUND);
  }

  private async findOwned(user: UserRecord, id: number) {
    const tracker = await this.prisma.acompanhamentos.findFirst({
      where: {
        id: positiveInt(id, "Acompanhamento não encontrado."),
        objetivo: { usuario_id: user.usuario_id },
      },
      select: { id: true },
    });
    if (!tracker) throw new HttpException("Acompanhamento não encontrado.", HttpStatus.NOT_FOUND);
    return tracker;
  }
}
