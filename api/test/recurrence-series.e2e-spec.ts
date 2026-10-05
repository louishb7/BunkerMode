import { Prisma } from "@prisma/client";

import { UserRecord } from "../src/auth/auth.types";
import { OperationalCalendarService } from "../src/calendar/operational-calendar.service";
import { GoalsService } from "../src/goals/goals.service";
import { TASK_STATUS } from "../src/tasks/task.types";
import { TasksService } from "../src/tasks/tasks.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { OrientationService } from "../src/orientation/orientation.service";
import { FinancesService } from "../src/finances/finances.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const originalDatabaseUrl = process.env.DATABASE_URL;

describeWithDatabase("Recurrence series persistence", () => {
  let prisma: PrismaService;
  let userId: number;
  let currentDate: string;
  let currentUser: UserRecord;
  let tasksService: TasksService;
  let goalsService: GoalsService;

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const user = await prisma.usuarios.create({
      data: {
        usuario: `recurrence-${suffix}`,
        email: `recurrence-${suffix}@bunker.local`,
        senha_hash: "hash",
      },
    });
    userId = user.usuario_id;
    currentUser = user;
    currentDate = "2026-08-31";
    const calendar = new OperationalCalendarService();
    jest
      .spyOn(calendar, "currentDateFor")
      .mockImplementation(() => currentDate);
    tasksService = new TasksService(prisma, calendar);
    goalsService = new GoalsService(prisma);
  });

  afterEach(async () => {
    await prisma.usuarios.delete({ where: { usuario_id: userId } });
  });

  function createSeries(
    overrides: Partial<Prisma.series_recorrenciaUncheckedCreateInput> = {},
  ) {
    return prisma.series_recorrencia.create({
      data: {
        responsavel_id: userId,
        titulo: "Treinar execução",
        prioridade: 2,
        recurrence_weekdays: [0, 2, 4],
        start_date: new Date("2026-09-01T00:00:00.000Z"),
        termination_policy: "sem_termino",
        ...overrides,
      },
    });
  }

  it("prepares today's recurrence for Home after a long absence with a bounded window and read-only orientation", async () => {
    currentDate = "2026-10-05";
    const calendar = new OperationalCalendarService();
    jest.spyOn(calendar, "currentDateFor").mockImplementation(() => currentDate);
    const orientation = new OrientationService(prisma, calendar, new FinancesService(prisma, calendar));
    const series = await createSeries({
      start_date: new Date("2025-01-01T00:00:00Z"),
      recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect((await orientation.read(currentUser)).tarefas).toEqual([]);
    expect(await prisma.missoes.count({ where: { recurrence_series_id: series.recurrence_series_id } })).toBe(0);
    await tasksService.materializeRecurrences(currentUser);
    const prepared = await orientation.read(currentUser);
    expect(prepared.tarefas).toHaveLength(1);
    expect(prepared.tarefas[0].recurrence?.series_id).toBe(series.recurrence_series_id);
    const occurrences = await prisma.missoes.findMany({
      where: { recurrence_series_id: series.recurrence_series_id }, orderBy: { prazo: "asc" },
    });
    expect(occurrences).toHaveLength(14);
    expect(occurrences[0].prazo?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(occurrences.at(-1)?.prazo?.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    const auditCount = await prisma.auditoria_eventos.count({ where: { usuario_id: userId } });
    await orientation.read(currentUser);
    await tasksService.materializeRecurrences(currentUser);
    expect(await prisma.auditoria_eventos.count({ where: { usuario_id: userId } })).toBe(auditCount);
  });

  function createTask(recurrenceSeriesId: number | null, title: string) {
    return prisma.missoes.create({
      data: {
        titulo: title,
        prazo: new Date("2026-09-02T00:00:00.000Z"),
        criada_por_id: userId,
        responsavel_id: userId,
        recurrence_series_id: recurrenceSeriesId,
      },
    });
  }

  function createRecurringTask(overrides: Record<string, unknown> = {}) {
    return tasksService.create(
      {
        titulo: "Treinar execução",
        prazo: "31-08-2026",
        recurrence_weekdays: [0],
        duration_type: "sem_termino",
        ...overrides,
      },
      currentUser,
    );
  }

  async function createObjective(title = "Objetivo recorrente") {
    return prisma.objetivos.create({
      data: {
        usuario_id: userId,
        titulo: title,
      },
    });
  }

  it("creates users with the default enabled modules", () => {
    expect(currentUser.enabled_modules).toEqual(["tasks", "objectives"]);
  });

  it.each(["complete"] as const)("reopens a persisted %s result without changing series identity", async (action) => {
    const occurrence = await createRecurringTask();
    await tasksService[action](occurrence.missao_id, currentUser);
    const reopened = await tasksService.reopen(occurrence.missao_id, currentUser);
    expect(reopened).toMatchObject({ status: "PENDENTE", completed_at: null,
      recurrence_series_id: occurrence.recurrence_series_id, prazo: occurrence.prazo });
    const history = await tasksService.taskHistory(occurrence.missao_id, currentUser);
    expect(history.map((event) => event.acao)).toEqual(["tarefa_recorrente_criada", "tarefa_concluida", "tarefa_reaberta"]);
    await tasksService.materializeRecurrences(currentUser);
    expect(await prisma.missoes.count({ where: { recurrence_series_id: occurrence.recurrence_series_id, prazo: occurrence.prazo } })).toBe(1);
  });

  it("reads persisted UTC results on the user's local day without changing date-only deadlines", async () => {
    const calendar = new OperationalCalendarService();
    const dateFor = jest.spyOn(calendar, "currentDateFor");
    const service = new TasksService(prisma, calendar);
    const result = await prisma.missoes.create({ data: { titulo: "Resultado noturno", criada_por_id: userId, responsavel_id: userId,
      prazo: new Date("2026-09-01T00:00:00Z"), status: "CONCLUIDA", completed_at: new Date("2026-09-09T01:00:00Z") } });
    dateFor.mockReturnValueOnce("2026-09-08");
    expect((await service.focusBoard(currentUser)).daily_tasks.map((item) => item.missao_id)).toContain(result.missao_id);
    dateFor.mockReturnValueOnce("2026-09-08");
    expect((await service.listDailyOperational(currentUser)).map((item) => item.missao_id)).toContain(result.missao_id);
    expect(await prisma.missoes.findUnique({ where: { missao_id: result.missao_id } })).toEqual(result);
  });

  it("creates a recurrence series without an objective", async () => {
    const series = await createSeries();

    expect(series).toMatchObject({
      responsavel_id: userId,
      objetivo_id: null,
      termination_policy: "sem_termino",
      ativo: true,
    });
  });

  it("creates an until-objective series linked to an owned objective", async () => {
    const objective = await prisma.objetivos.create({
      data: {
        usuario_id: userId,
        titulo: "Concluir fundação",
      },
    });

    const series = await createSeries({
      objetivo_id: objective.id,
      termination_policy: "ate_objetivo",
    });

    expect(series.objetivo_id).toBe(objective.id);
  });

  it("preserves the series when its objective is deleted", async () => {
    const objective = await prisma.objetivos.create({
      data: {
        usuario_id: userId,
        titulo: "Objetivo removível",
      },
    });
    const series = await createSeries({ objetivo_id: objective.id });

    await prisma.objetivos.delete({ where: { id: objective.id } });

    await expect(
      prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: series.recurrence_series_id },
      }),
    ).resolves.toMatchObject({ objetivo_id: null });
  });

  it("rejects an until-date series without an end date", async () => {
    await expect(
      createSeries({ termination_policy: "ate_data" }),
    ).rejects.toBeDefined();
  });

  it("rejects weekdays outside the Monday-to-Sunday range", async () => {
    await expect(
      createSeries({ recurrence_weekdays: [0, 7] }),
    ).rejects.toBeDefined();
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      createSeries({
        termination_policy: "ate_data",
        end_date: new Date("2026-08-31T00:00:00.000Z"),
      }),
    ).rejects.toBeDefined();
  });

  it("rejects two occurrences from the same series on the same date", async () => {
    const series = await createSeries();
    await createTask(series.recurrence_series_id, "Primeira ocorrência");

    await expect(
      createTask(series.recurrence_series_id, "Ocorrência duplicada"),
    ).rejects.toBeDefined();
  });

  it("allows two one-time tasks on the same date", async () => {
    await createTask(null, "Ordem pontual A");
    await createTask(null, "Ordem pontual B");

    await expect(
      prisma.missoes.count({
        where: { responsavel_id: userId, recurrence_series_id: null },
      }),
    ).resolves.toBe(2);
  });

  it("allows different series to generate occurrences on the same date", async () => {
    const firstSeries = await createSeries({ titulo: "Série A" });
    const secondSeries = await createSeries({ titulo: "Série B" });

    await createTask(firstSeries.recurrence_series_id, "Ocorrência A");
    await createTask(secondSeries.recurrence_series_id, "Ocorrência B");

    await expect(
      prisma.missoes.count({
        where: { responsavel_id: userId, recurrence_series_id: { not: null } },
      }),
    ).resolves.toBe(2);
  });

  it("creates and materializes a normalized endless recurrence without an objective", async () => {
    const firstOccurrence = await createRecurringTask({
      recurrence_weekdays: [2, 0, 2],
    });

    const series = await prisma.series_recorrencia.findUniqueOrThrow({
      where: { recurrence_series_id: firstOccurrence.recurrence_series_id! },
    });
    const occurrences = await prisma.missoes.findMany({
      where: { recurrence_series_id: series.recurrence_series_id },
      orderBy: { prazo: "asc" },
    });

    expect(series).toMatchObject({
      objetivo_id: null,
      recurrence_weekdays: [0, 2],
      termination_policy: "sem_termino",
    });
    expect(occurrences.length).toBeGreaterThan(1);
  });

  it("creates an until-objective recurrence with an active owned objective", async () => {
    const objective = await createObjective();

    const firstOccurrence = await createRecurringTask({
      objetivo_id: objective.id,
      duration_type: "ate_objetivo",
    });

    await expect(
      prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: firstOccurrence.recurrence_series_id! },
      }),
    ).resolves.toMatchObject({
      objetivo_id: objective.id,
      termination_policy: "ate_objetivo",
    });
  });

  it("rejects an until-objective recurrence without an objective", async () => {
    await expect(
      createRecurringTask({ duration_type: "ate_objetivo" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an until-date recurrence without an end date", async () => {
    await expect(
      createRecurringTask({ duration_type: "ate_data" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a recurrence without weekdays", async () => {
    await expect(
      createRecurringTask({ recurrence_weekdays: [] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a recurrence linked to another user's objective", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const otherUser = await prisma.usuarios.create({
      data: {
        usuario: `other-${suffix}`,
        email: `other-${suffix}@bunker.local`,
        senha_hash: "hash",
      },
    });
    const objective = await prisma.objetivos.create({
      data: {
        usuario_id: otherUser.usuario_id,
        titulo: "Objetivo de outro usuário",
      },
    });

    await expect(
      createRecurringTask({ objetivo_id: objective.id }),
    ).rejects.toMatchObject({ status: 400 });
    await prisma.usuarios.delete({
      where: { usuario_id: otherUser.usuario_id },
    });
  });

  it("rejects a recurrence linked to an inactive objective", async () => {
    const objective = await createObjective("Objetivo pausado");
    await prisma.objetivos.update({
      where: { id: objective.id },
      data: { status: "pausado" },
    });

    await expect(
      createRecurringTask({ objetivo_id: objective.id }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(["pausado", "concluido", "abandonado"]) (
    "keeps an existing task editable when its objective becomes %s",
    async (status) => {
      const objective = await createObjective(`Objetivo ${status}`);
      const task = await tasksService.create(
        { titulo: "Ordem vinculada", objetivo_id: objective.id },
        currentUser,
      );
      await prisma.objetivos.update({
        where: { id: objective.id },
        data: {
          status,
          concluded_at: status === "concluido" ? new Date() : null,
        },
      });

      await expect(
        tasksService.update(
          task.missao_id,
          { titulo: "Ordem editada" },
          currentUser,
        ),
      ).resolves.toMatchObject({
        titulo: "Ordem editada",
        objetivo_id: objective.id,
      });
      await expect(
        tasksService.update(
          task.missao_id,
          { objetivo_id: objective.id, instrucao: "Mesmo vínculo" },
          currentUser,
        ),
      ).resolves.toMatchObject({ objetivo_id: objective.id });
    },
  );

  it("materializes the same series repeatedly without duplicating dates", async () => {
    const firstOccurrence = await createRecurringTask();
    const seriesId = firstOccurrence.recurrence_series_id!;
    currentDate = "2026-09-08";

    await tasksService.materializeRecurrences(currentUser);
    const afterFirstMaterialization = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });
    await tasksService.materializeRecurrences(currentUser);
    const afterSecondMaterialization = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });
    const duplicatedDates = await prisma.missoes.groupBy({
      by: ["prazo"],
      where: { recurrence_series_id: seriesId },
      _count: { _all: true },
      having: { prazo: { _count: { gt: 1 } } },
    });

    expect(afterSecondMaterialization).toBe(afterFirstMaterialization);
    expect(duplicatedDates).toEqual([]);
  });

  it("preserves a recurring occurrence identity after rejected rescheduling", async () => {
    const firstOccurrence = await createRecurringTask();
    const seriesId = firstOccurrence.recurrence_series_id!;
    const originalDate = firstOccurrence.prazo!;

    await expect(
      tasksService.update(
        firstOccurrence.missao_id,
        { prazo: "01-09-2026" },
        currentUser,
      ),
    ).rejects.toMatchObject({ status: 400 });

    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);
    const originalOccurrences = await prisma.missoes.findMany({
      where: { recurrence_series_id: seriesId, prazo: originalDate },
    });

    expect(originalOccurrences).toHaveLength(1);
    await expect(
      prisma.missoes.findUniqueOrThrow({
        where: { missao_id: firstOccurrence.missao_id },
      }),
    ).resolves.toMatchObject({ prazo: originalDate, recurrence_series_id: seriesId });
  });

  it("deletes all pending occurrences of a linked series, preserves completed history and never rematerializes it", async () => {
    const goal = await createObjective();
    const first = await createRecurringTask({
      objetivo_id: goal.id,
      duration_type: "ate_objetivo",
      recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const unrelated = await createRecurringTask({
      titulo: "Outra recorrência",
    });
    await tasksService.complete(first.missao_id, currentUser);
    const history = await tasksService.taskHistory(
      first.missao_id,
      currentUser,
    );
    const seriesId = first.recurrence_series_id!;
    const linked = (await tasksService.listForTasksBoard(currentUser)).filter(
      (t) => t.recurrence_series_id === seriesId,
    );
    expect(linked.length).toBeGreaterThan(2);
    expect(linked.every((t) => t.objetivo_id === goal.id)).toBe(true);
    const pending = linked.find((t) => t.status === "PENDENTE")!;
    await expect(
      tasksService.delete(pending.missao_id, {
        ...currentUser,
        usuario_id: userId + 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      tasksService.delete(first.missao_id, currentUser),
    ).rejects.toMatchObject({ status: 400 });
    currentDate = "2026-09-05";
    await tasksService.delete(pending.missao_id, currentUser);
    expect(
      await prisma.missoes.findMany({
        where: { recurrence_series_id: seriesId },
      }),
    ).toEqual([
      expect.objectContaining({
        missao_id: first.missao_id,
        status: "CONCLUIDA",
      }),
    ]);
    expect(
      await tasksService.taskHistory(first.missao_id, currentUser),
    ).toEqual(history);
    expect(
      await prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: seriesId },
      }),
    ).toMatchObject({ ativo: false, objetivo_id: goal.id });
    expect(
      await prisma.objetivos.findUniqueOrThrow({ where: { id: goal.id } }),
    ).toMatchObject({ status: "ativo" });
    expect(
      await prisma.missoes.count({
        where: { recurrence_series_id: unrelated.recurrence_series_id },
      }),
    ).toBeGreaterThan(0);
    currentDate = "2026-09-20";
    await tasksService.materializeRecurrences(currentUser);
    expect(
      await prisma.missoes.count({ where: { recurrence_series_id: seriesId } }),
    ).toBe(1);
  });


  it("reads explicitly materialized recurrence and retains completed and pending outcomes", async () => {
    const firstOccurrence = await createRecurringTask();
    const pendingOccurrence = await tasksService.create(
      { titulo: "Revisar conteúdo", prazo: "2026-08-31" },
      currentUser,
    );
    await tasksService.complete(firstOccurrence.missao_id, currentUser);

    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);
    const firstBoard = await tasksService.listForTasksBoard(currentUser);
    const occurrenceCount = await prisma.missoes.count({
      where: { recurrence_series_id: firstOccurrence.recurrence_series_id },
    });
    const secondBoard = await tasksService.listForTasksBoard(currentUser);
    const afterSecondRead = await prisma.missoes.count({
      where: { recurrence_series_id: firstOccurrence.recurrence_series_id },
    });

    expect(firstBoard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missao_id: firstOccurrence.missao_id,
          status: TASK_STATUS.completed,
        }),
        expect.objectContaining({
          missao_id: pendingOccurrence.missao_id,
          status: TASK_STATUS.pending,
        }),
      ]),
    );
    expect(secondBoard.map((task) => task.missao_id)).toEqual(
      firstBoard.map((task) => task.missao_id),
    );
    expect(afterSecondRead).toBe(occurrenceCount);
  });

  it("uses the database uniqueness guarantee under concurrent materialization", async () => {
    const firstOccurrence = await createRecurringTask();
    const seriesId = firstOccurrence.recurrence_series_id!;
    currentDate = "2026-09-08";

    await Promise.all([
      tasksService.materializeRecurrences(currentUser),
      tasksService.materializeRecurrences(currentUser),
    ]);

    const occurrences = await prisma.missoes.findMany({
      where: { recurrence_series_id: seriesId },
      orderBy: { prazo: "asc" },
    });
    expect(
      new Set(occurrences.map((task) => task.prazo?.toISOString())).size,
    ).toBe(occurrences.length);
  });

  it("continues materializing after one occurrence is completed", async () => {
    const firstOccurrence = await createRecurringTask();
    const seriesId = firstOccurrence.recurrence_series_id!;
    const initialCount = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });

    await tasksService.complete(firstOccurrence.missao_id, currentUser);
    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);

    const finalized = await prisma.missoes.findUniqueOrThrow({
      where: { missao_id: firstOccurrence.missao_id },
    });
    const finalCount = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });
    expect(finalized.status).toBe(TASK_STATUS.completed);
    expect(finalCount).toBeGreaterThan(initialCount);
  });

  it("continues materializing while a previous occurrence remains pending", async () => {
    const firstOccurrence = await createRecurringTask();
    const seriesId = firstOccurrence.recurrence_series_id!;
    const initialCount = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });

    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);

    const finalized = await prisma.missoes.findUniqueOrThrow({
      where: { missao_id: firstOccurrence.missao_id },
    });
    const finalCount = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });
    expect(finalized.status).toBe(TASK_STATUS.pending);
    expect(finalCount).toBeGreaterThan(initialCount);
  });

  it.each(["concluido", "pausado", "abandonado"])(
    "does not materialize an until-objective series when the objective is %s",
    async (status) => {
      const objective = await createObjective(`Objetivo ${status}`);
      const firstOccurrence = await createRecurringTask({
        objetivo_id: objective.id,
        duration_type: "ate_objetivo",
      });
      const seriesId = firstOccurrence.recurrence_series_id!;
      const initialCount = await prisma.missoes.count({
        where: { recurrence_series_id: seriesId },
      });
      await prisma.objetivos.update({
        where: { id: objective.id },
        data: {
          status,
          concluded_at: status === "concluido" ? new Date() : null,
        },
      });

      currentDate = "2026-09-08";
      await tasksService.materializeRecurrences(currentUser);

      await expect(
        prisma.missoes.count({ where: { recurrence_series_id: seriesId } }),
      ).resolves.toBe(initialCount);
    },
  );

  it("deactivates an until-objective series when its objective is deleted", async () => {
    const objective = await createObjective("Objetivo descartável");
    const firstOccurrence = await createRecurringTask({
      objetivo_id: objective.id,
      duration_type: "ate_objetivo",
    });
    const seriesId = firstOccurrence.recurrence_series_id!;
    const occurrenceCount = await prisma.missoes.count({
      where: { recurrence_series_id: seriesId },
    });

    await goalsService.delete(currentUser, objective.id);

    await expect(
      prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: seriesId },
      }),
    ).resolves.toMatchObject({ ativo: false, objetivo_id: null });
    await expect(
      prisma.missoes.count({ where: { recurrence_series_id: seriesId } }),
    ).resolves.toBe(occurrenceCount);
    const occurrences = await prisma.missoes.findMany({
      where: { recurrence_series_id: seriesId },
    });
    expect(occurrences.every((task) => task.objetivo_id === null)).toBe(
      true,
    );
  });

  it("preserves orders, results and audit when their independent goal is deleted", async () => {
    const goal = await goalsService.create(currentUser, {
      titulo: "Objetivo independente",
    });
    const completed = await tasksService.create(
      { titulo: "Concluir", objetivo_id: goal.id },
      currentUser,
    );
    const pending = await tasksService.create(
      { titulo: "Revisar", objetivo_id: goal.id },
      currentUser,
    );
    await tasksService.complete(completed.missao_id, currentUser);
    await expect(
      prisma.objetivos.findUniqueOrThrow({ where: { id: goal.id } }),
    ).resolves.toMatchObject({ status: "ativo", concluded_at: null });
    await goalsService.delete(currentUser, goal.id);
    const orders = await prisma.missoes.findMany({
      where: { responsavel_id: userId },
      orderBy: { missao_id: "asc" },
    });
    expect(orders).toHaveLength(2);
    expect(orders.map((task) => task.status)).toEqual([
      "CONCLUIDA",
      "PENDENTE",
    ]);
    expect(orders.every((task) => task.objetivo_id === null)).toBe(true);
    expect(orders[0].completed_at).not.toBeNull();
    expect(orders[1].completed_at).toBeNull();
    expect(
      await prisma.auditoria_eventos.count({ where: { usuario_id: userId } }),
    ).toBe(3);
  });

  it("materializes an until-date series only through its inclusive end date", async () => {
    const first = await createRecurringTask({
      duration_type: "ate_data",
      recurrence_end_date: "2026-09-14",
    });
    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);
    currentDate = "2026-09-15";
    await tasksService.materializeRecurrences(currentUser);
    const orders = await prisma.missoes.findMany({
      where: { recurrence_series_id: first.recurrence_series_id },
      orderBy: { prazo: "asc" },
    });
    expect(
      orders.map((task) => task.prazo?.toISOString().slice(0, 10)),
    ).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("keeps an endless series running after its goal is deleted", async () => {
    const goal = await createObjective();
    const first = await createRecurringTask({ objetivo_id: goal.id });
    await goalsService.delete(currentUser, goal.id);
    currentDate = "2026-09-08";
    await tasksService.materializeRecurrences(currentUser);
    await expect(
      prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: first.recurrence_series_id! },
      }),
    ).resolves.toMatchObject({ ativo: true, objetivo_id: null });
    const orders = await prisma.missoes.findMany({
      where: { recurrence_series_id: first.recurrence_series_id },
    });
    expect(orders.length).toBeGreaterThan(2);
    expect(orders.every((task) => task.objetivo_id === null)).toBe(true);
  });

  it("rejects an empty or null weekday list at the database boundary", async () => {
    await expect(
      createSeries({ recurrence_weekdays: [] }),
    ).rejects.toBeDefined();
    const series = await createSeries();
    await expect(
      prisma.$executeRaw`UPDATE series_recorrencia SET recurrence_weekdays = NULL WHERE recurrence_series_id = ${series.recurrence_series_id}`,
    ).rejects.toBeDefined();
  });

  it.each([
    { status: "invalido" },
    { status: "CONCLUIDA", completed_at: null },
    { status: "FALHA" },
    { status: "PENDENTE", completed_at: new Date() },
    { prioridade: 4 },
  ])("preserves database task state checks for %j", async (data) => {
    const order = await createTask(null, "Ordem válida");
    await expect(
      prisma.missoes.update({ where: { missao_id: order.missao_id }, data }),
    ).rejects.toBeDefined();
  });

  it.each([
    { status: "invalido" },
    { status: "concluido", concluded_at: null },
    { status: "ativo", concluded_at: new Date() },
  ])("preserves database goal state checks for %j", async (data) => {
    const goal = await createObjective();
    await expect(
      prisma.objetivos.update({ where: { id: goal.id }, data }),
    ).rejects.toBeDefined();
  });

  it("preserves series policy, priority and occurrence-date checks", async () => {
    await expect(
      createSeries({ termination_policy: "invalida" }),
    ).rejects.toBeDefined();
    await expect(createSeries({ prioridade: 0 })).rejects.toBeDefined();
    await expect(
      createSeries({ end_date: new Date("2026-09-30T00:00:00.000Z") }),
    ).rejects.toBeDefined();
    const series = await createSeries();
    await expect(
      prisma.missoes.create({
        data: {
          titulo: "Ocorrência sem data",
          criada_por_id: userId,
          responsavel_id: userId,
          recurrence_series_id: series.recurrence_series_id,
        },
      }),
    ).rejects.toBeDefined();
  });
});
