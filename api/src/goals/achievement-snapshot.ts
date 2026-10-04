import { Prisma } from "@prisma/client";
import { UserRecord } from "../auth/auth.types";
import { dateOnly } from "../common/domain-helpers";
import { toTaskResponse } from "../tasks/task-response";

// Only facts needed by the final map; never copy full occurrence/task histories.
export async function captureAchievement(
  tx: Prisma.TransactionClient,
  goalId: number,
  user: UserRecord,
  now: Date,
): Promise<Prisma.InputJsonObject> {
  const goal = await tx.objetivos.findFirstOrThrow({
    where: { id: goalId, usuario_id: user.usuario_id },
    include: {
      missoes: {
        where: { responsavel_id: user.usuario_id },
        include: { serie_recorrencia: true },
        orderBy: { missao_id: "asc" },
      },
      series_recorrencia: {
        where: { responsavel_id: user.usuario_id },
        orderBy: { recurrence_series_id: "asc" },
      },
      acompanhamentos: {
        where: { usuario_id: user.usuario_id },
        orderBy: { id: "asc" },
        include: {
          _count: { select: { ocorrencias: true } },
          ocorrencias: {
            orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      },
    },
  });
  const nodes: Prisma.InputJsonObject[] = [];
  for (const task of goal.missoes.filter(
    (item) => !item.recurrence_series_id,
  )) {
    const response = toTaskResponse(task, user, now);
    nodes.push({
      id: `task-${response.id}`,
      tipo: "tarefa",
      titulo: response.titulo,
      descricao: response.instrucao,
      estado: response.status_code,
      data: dateOnly(task.prazo),
      atividade_em: response.completed_at,
    });
  }
  for (const series of goal.series_recorrencia) {
    const tasks = goal.missoes.filter(
      (task) => task.recurrence_series_id === series.recurrence_series_id,
    );
    nodes.push({
      id: `routine-${series.recurrence_series_id}`,
      tipo: "rotina",
      titulo: series.titulo,
      descricao: series.instrucao,
      frequencia: series.recurrence_weekdays,
      estado: series.ativo ? "ativa" : "pausada",
      atividade_em:
        tasks
          .map((task) => task.completed_at?.toISOString())
          .filter((date): date is string => !!date)
          .sort()
          .at(-1) ?? null,
      realizadas: tasks.filter((task) => task.status === "CONCLUIDA").length,
    });
  }
  for (const tracker of goal.acompanhamentos) {
    nodes.push({
      id: `tracker-${tracker.id}`,
      tipo: "acompanhamento",
      titulo: tracker.titulo,
      descricao: tracker.descricao,
      ocorrencias_total: tracker._count.ocorrencias,
      ultima_ocorrencia:
        tracker.ocorrencias[0]?.occurred_at.toISOString() ?? null,
    });
  }
  return {
    version: 1,
    titulo: goal.titulo,
    proposito: goal.descricao,
    criado_em: goal.created_at.toISOString(),
    data_alvo: dateOnly(goal.data_alvo),
    fuso_horario: user.timezone ?? "America/Recife",
    nos: nodes,
  };
}
