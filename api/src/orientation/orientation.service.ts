import { Injectable } from "@nestjs/common";
import { UserRecord } from "../auth/auth.types";
import { OperationalCalendarService } from "../calendar/operational-calendar.service";
import { PrismaService } from "../prisma/prisma.service";
import { FinancesService } from "../finances/finances.service";
import { toTaskResponse } from "../tasks/task-response";

@Injectable()
export class OrientationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: OperationalCalendarService,
    private readonly finances: FinancesService,
  ) {}
  async read(user: UserRecord, includeTasks = true) {
    const enabled = new Set(user.enabled_modules);
    if (!includeTasks) enabled.delete("tasks");
    const falhas: Record<string, string> = {};
    async function readPart<T>(
      name: string,
      query: () => Promise<T>,
      fallback: T,
    ): Promise<T> {
      try {
        return await query();
      } catch {
        falhas[name] = "Não foi possível consultar este estado.";
        return fallback;
      }
    }
    const today = this.calendar.currentDateFor(new Date(), user.timezone);
    const day = new Date(`${today}T00:00:00Z`);
    const tasksPromise = enabled.has("tasks")
      ? readPart(
          "tarefas",
          () =>
            this.prisma.missoes.findMany({
              where: {
                responsavel_id: user.usuario_id,
                prazo: day,
                status: "PENDENTE",
              },
              include: { serie_recorrencia: true },
              orderBy: [
                { is_pinned: "desc" },
                { prioridade: "asc" },
                { missao_id: "asc" },
              ],
              take: 3,
            }),
          [],
        )
      : [];
    const goalsPromise = enabled.has("objectives")
      ? readPart(
          "direcoes",
          () =>
            this.prisma.objetivos.findMany({
              where: { usuario_id: user.usuario_id, status: "ativo" },
              orderBy: [{ order_index: "asc" }, { id: "asc" }],
              take: 3,
              select: {
                id: true,
                titulo: true,
                status: true,
                data_alvo: true,
                acompanhamentos: {
                  where: { usuario_id: user.usuario_id },
                  orderBy: { id: "asc" },
                  take: 2,
                  include: {
                    ocorrencias: {
                      orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
                      take: 1,
                    },
                  },
                },
                ...(enabled.has("tasks")
                  ? {
                      missoes: {
                        where: {
                          responsavel_id: user.usuario_id,
                          status: "PENDENTE",
                          prazo: day,
                        },
                        take: 2,
                        orderBy: { is_pinned: "desc" as const },
                        include: { serie_recorrencia: true },
                      },
                    }
                  : {}),
              },
            }),
          [],
        )
      : [];
    const financialPromise = enabled.has("finances")
      ? readPart("recursos", () => this.finances.registeredBalance(user), null)
      : null;
    const [tasks, goals, financial] = await Promise.all([
      tasksPromise,
      goalsPromise,
      financialPromise,
    ]);
    return {
      data: today,
      falhas,
      tarefas: tasks.map((task) => toTaskResponse(task, user)),
      direcoes: goals.map((goal) => ({
        id: goal.id,
        titulo: goal.titulo,
        status: goal.status,
        data_alvo: goal.data_alvo?.toISOString().slice(0, 10) ?? null,
        trackers: goal.acompanhamentos,
        tasks: enabled.has("tasks")
          ? goal.missoes.map((task) => toTaskResponse(task, user))
          : [],
      })),
      // Um saldo negativo é o único sinal financeiro independente na Home.
      financeiro:
        financial !== null && financial < 0
          ? { saldo_centavos: financial }
          : null,
    };
  }
}
