import { UserRecord } from "../src/auth/auth.types";
import { OperationalCalendarService } from "../src/calendar/operational-calendar.service";
import { toTaskResponse } from "../src/tasks/task-response";
import { TasksService } from "../src/tasks/tasks.service";
import { TASK_STATUS, TaskRecord } from "../src/tasks/task.types";
import { PrismaService } from "../src/prisma/prisma.service";

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    usuario_id: 7,
    usuario: "usuario-teste",
    email: "usuario-teste@bunker.local",
    senha_hash: "hash",
    auth_version: 0,
    ativo: true,
    enabled_modules: ["tasks", "objectives"],
    timezone: "America/Recife",
    created_at: new Date("2026-04-24T12:00:00.000Z"),
    updated_at: new Date("2026-04-24T12:00:00.000Z"),
    ...overrides,
  };
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    missao_id: 10,
    titulo: "Revisar plano semanal",
    prioridade: 2,
    prazo: new Date("2026-04-25T00:00:00.000Z"),
    instrucao: "Abrir relatório e registrar decisões.",
    status: TASK_STATUS.pending,
    is_pinned: false,
    created_at: new Date("2026-04-24T12:00:00.000Z"),
    updated_at: new Date("2026-04-24T12:00:00.000Z"),
    completed_at: null,
    recurrence_series_id: null,
    criada_por_id: 7,
    responsavel_id: 7,
    objetivo_id: null,
    ...overrides,
  };
}

function prismaMock() {
  return {
    $transaction: jest.fn(),
    auditoria_eventos: {
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    missoes: {
      create: jest.fn(),
      createManyAndReturn: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    objetivos: {
      findFirst: jest.fn(),
    },
    series_recorrencia: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
  };
}

describe("Tasks clean domain", () => {
  const calendar = new OperationalCalendarService();

  it("limits daily query to the operational date and nearby completions", async () => {
    const prisma = prismaMock();
    const service = new TasksService(prisma as never, calendar);
    jest.useFakeTimers().setSystemTime(new Date("2026-09-09T12:00:00Z"));
    try {
      await service.listDailyOperational(user());
      expect(prisma.missoes.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.missoes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            responsavel_id: 7,
            OR: [
              { prazo: new Date("2026-09-09T00:00:00Z") },
              { completed_at: { gte: new Date("2026-09-08T00:00:00Z"), lt: new Date("2026-09-11T00:00:00Z") } },
            ],
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not write when the recurrence window is already materialized", async () => {
    const prisma = prismaMock();
    const series = {
      recurrence_series_id: 21,
      responsavel_id: 7,
      objetivo_id: null,
      objetivos: null,
      start_date: new Date("2026-09-09T00:00:00Z"),
      end_date: null,
      termination_policy: "sem_termino",
      recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
    };
    prisma.series_recorrencia.findMany.mockResolvedValue([series]);
    prisma.missoes.findMany.mockResolvedValue(Array.from({ length: 14 }, (_, offset) => ({
      recurrence_series_id: 21,
      prazo: new Date(Date.UTC(2026, 8, 9 + offset)),
    })));
    const service = new TasksService(prisma as never, calendar);
    jest.useFakeTimers().setSystemTime(new Date("2026-09-09T12:00:00Z"));
    try {
      await service.materializeRecurrences(user());
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.missoes.createManyAndReturn).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  describe.each(["completed_at"] as const)("operational day of %s", (field) => {
    it.each([
      ["America/Recife", "2026-09-08T15:00:00Z", "2026-09-08T16:00:00Z", true],
      ["America/Recife", "2026-09-09T01:00:00Z", "2026-09-09T02:00:00Z", true],
      ["America/Recife", "2026-09-09T03:01:00Z", "2026-09-09T04:00:00Z", true],
      ["America/Recife", "2026-09-09T02:59:00Z", "2026-09-09T03:01:00Z", false],
      ["Pacific/Kiritimati", "2026-09-08T10:01:00Z", "2026-09-08T11:00:00Z", true],
      ["Pacific/Kiritimati", "2026-09-08T09:59:00Z", "2026-09-08T10:01:00Z", false],
      ["America/New_York", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", true],
    ])("interprets %s event %s at %s", async (timezone, event, now, included) => {
      jest.useFakeTimers().setSystemTime(new Date(now as string));
      try {
        const prisma = prismaMock();
        const resultTask = task({ prazo: new Date("2026-01-01T00:00:00Z"),
          status: TASK_STATUS.completed,
          [field]: new Date(event as string) });
        prisma.missoes.findMany.mockResolvedValue([resultTask]);
        const service = new TasksService(prisma as never, calendar);
        const owner = user({ timezone: timezone as string });
        const focus = await service.focusBoard(owner);
        expect(focus.daily_tasks).toEqual(included ? [resultTask] : []);
        expect(focus.action_tasks).toEqual([]);
        expect(await service.listDailyOperational(owner)).toEqual(focus.daily_tasks);
        expect(await service.listHistorical(owner)).toEqual([resultTask]);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(resultTask[field]?.toISOString()).toBe(new Date(event as string).toISOString());
      } finally { jest.useRealTimers(); }
    });
  });

  it("keeps date-only deadlines on their civil date in positive and negative timezones", async () => {
    const prisma = prismaMock();
    prisma.missoes.findMany.mockResolvedValue([task({ prazo: new Date("2026-09-08T00:00:00Z") })]);
    jest.useFakeTimers().setSystemTime(new Date("2026-09-08T09:00:00Z"));
    try {
      const service = new TasksService(prisma as never, calendar);
      for (const timezone of ["America/Recife", "Pacific/Kiritimati"]) {
        expect((await service.focusBoard(user({ timezone }))).daily_tasks).toHaveLength(1);
      }
    } finally { jest.useRealTimers(); }
  });

  it.each([TASK_STATUS.completed])("reopens %s explicitly, preserving task data and audit history", async (status) => {
    const prisma = prismaMock();
    const original = task({ status, objetivo_id: 3, recurrence_series_id: 21,
      completed_at: new Date() });

    prisma.missoes.findFirst.mockResolvedValue(original);
    prisma.missoes.update.mockImplementation(async ({ data }) => ({ ...original, ...data }));
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const service = new TasksService(prisma as never, calendar);
    expect(toTaskResponse(original, user()).permissions.can_reopen).toBe(true);
    expect(toTaskResponse(original, user({ usuario_id: 99 })).permissions.can_reopen).toBe(false);
    await expect(service.update(10, { status: "PENDENTE" }, user())).rejects.toMatchObject({ status: 400 });
    const result = await service.reopen(10, user());
    expect(result).toEqual({ ...original, status: TASK_STATUS.pending, completed_at: null });
    expect(toTaskResponse(result, user()).permissions.can_reopen).toBe(false);
    expect(prisma.auditoria_eventos.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: "tarefa_reaberta", missao_id: 10, usuario_id: 7 }) });
    expect(prisma.auditoria_eventos.deleteMany).not.toHaveBeenCalled();
    expect(prisma.series_recorrencia.updateMany).not.toHaveBeenCalled();
  });

  it("rejects reopening pending, missing and foreign tasks without writing", async () => {
    const prisma = prismaMock();
    const service = new TasksService(prisma as never, calendar);
    prisma.missoes.findFirst.mockResolvedValue(task());
    await expect(service.reopen(10, user())).rejects.toMatchObject({ status: 400 });
    prisma.missoes.findFirst.mockResolvedValue(null);
    await expect(service.reopen(999, user())).rejects.toMatchObject({ status: 404 });
    await expect(service.reopen(10, user({ usuario_id: 99 }))).rejects.toMatchObject({ status: 404 });
    expect(prisma.missoes.findFirst).toHaveBeenLastCalledWith({ where: { missao_id: 10, responsavel_id: 99 } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("maps the task contract consumed by the web", () => {
    const response = toTaskResponse(task(), user(), new Date("2026-04-25T12:00:00Z"));

    expect(response).toMatchObject({
      id: 10,
      titulo: "Revisar plano semanal",
      prioridade: 2,
      prazo: "25-04-2026",
      status: "PENDENTE",
      status_code: "PENDENTE",
      status_label: "Pendente",
      user_id: 7,
      responsavel_id: 7,
    });
    expect(Object.keys(response).sort()).toEqual(
      [
        "id",
        "titulo",
        "prioridade",
        "prazo",
        "instrucao",
        "status",
        "status_code",
        "status_label",
        "is_pinned",
        "created_at",
        "updated_at",
        "completed_at",
        "user_id",
        "criada_por_id",
        "responsavel_id",
        "objetivo_id",
        "recurrence",
        "permissions",
      ].sort(),
    );
    expect(response.permissions).toEqual({
      can_complete: true,
      can_edit: true,
      can_delete: true,
      can_pin: true,
      can_view_history: false,
      can_reopen: false,
    });
  });

  it("restricts task permissions by ownership", () => {
    const foreignPermissions = toTaskResponse(
      task(),
      user({ usuario_id: 99 }),
    ).permissions;

    expect(foreignPermissions).toEqual({
      can_complete: false,
      can_edit: false,
      can_delete: false,
      can_pin: false,
      can_view_history: false,
      can_reopen: false,
    });
  });

  it("reads tasks and history without materializing recurrences", async () => {
    const prisma = prismaMock();
    const completed = task({
      missao_id: 11,
      status: TASK_STATUS.completed,
      completed_at: new Date("2026-08-13T12:00:00.000Z"),
    });
    const overdue = task({
      missao_id: 12,
      status: TASK_STATUS.pending,
    });
    prisma.missoes.findMany.mockResolvedValue([task(), completed, overdue]);
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    await expect(service.listForTasksBoard(user())).resolves.toEqual([
      task(),
      completed,
      overdue,
    ]);
    expect(prisma.series_recorrencia.findMany).not.toHaveBeenCalled();
    expect(prisma.missoes.findMany).toHaveBeenCalledWith({
      where: { responsavel_id: 7 },
      include: { serie_recorrencia: true },
      orderBy: [
        { is_pinned: "desc" },
        { status: "asc" },
        { prazo: "asc" },
        { missao_id: "asc" },
      ],
    });

    prisma.series_recorrencia.findMany.mockClear();
    await expect(service.listHistorical(user())).resolves.toEqual([
      task(),
      completed,
      overdue,
    ]);
    expect(prisma.series_recorrencia.findMany).not.toHaveBeenCalled();
    await service.listDailyOperational(user());
    expect(prisma.series_recorrencia.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.missoes.update).not.toHaveBeenCalled();
    expect(prisma.auditoria_eventos.create).not.toHaveBeenCalled();
  });

  it("materializes recurrences through the explicit task command", async () => {
    const prisma = prismaMock();
    prisma.series_recorrencia.findMany.mockResolvedValue([
      {
        recurrence_series_id: 21,
        responsavel_id: 7,
        objetivo_id: null,
        titulo: "Treinar execução",
        instrucao: null,
        prioridade: 2,
        recurrence_weekdays: [3],
        start_date: new Date("2026-08-13T00:00:00.000Z"),
        termination_policy: "sem_termino",
        end_date: null,
        ativo: true,
        objetivos: null,
      },
    ]);
    prisma.missoes.createManyAndReturn.mockResolvedValue([
      task({
        recurrence_series_id: 21,
        prazo: new Date("2026-08-13T00:00:00.000Z"),
      }),
    ]);
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const service = new TasksService(prisma as never, calendar);
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T12:00:00.000Z"));

    await expect(service.materializeRecurrences(user())).resolves.toBeUndefined();

    const occurrenceCall = prisma.missoes.createManyAndReturn.mock.calls[0][0];
    expect(occurrenceCall.skipDuplicates).toBe(true);
    expect(
      occurrenceCall.data.map((item: { prazo: Date }) =>
        item.prazo.toISOString().slice(0, 10),
      ),
    ).toEqual(["2026-08-13", "2026-08-20"]);
    expect(occurrenceCall.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recurrence_series_id: 21,
          status: TASK_STATUS.pending,
        }),
      ]),
    );
    expect(prisma.auditoria_eventos.createMany).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("uses the recurrence series as the V2 recurrence response source", () => {
    const response = toTaskResponse(
      task({
        recurrence_series_id: 21,
        serie_recorrencia: {
          recurrence_series_id: 21,
          recurrence_weekdays: [0, 2, 4],
          termination_policy: "ate_data",
          end_date: new Date("2026-05-15T00:00:00.000Z"),
        },
      }),
      user(),
    );

    expect(response.recurrence).toEqual({
      series_id: 21,
      weekdays: [0, 2, 4],
      termination_policy: "ate_data",
      end_date: "15-05-2026",
    });
  });

  it("allows the owner to edit, reschedule and delete a one-time task", async () => {
    const prisma = prismaMock();
    prisma.missoes.findFirst.mockResolvedValue(task());
    prisma.missoes.update.mockResolvedValue(task({
      titulo: "Ordem ajustada",
      prazo: new Date("2026-04-26T00:00:00.000Z"),
    }));
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        auditoria_eventos: prisma.auditoria_eventos,
        missoes: prisma.missoes,
      }),
    );
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );
    const owner = user();

    await expect(
      service.update(
        10,
        { titulo: "Ordem ajustada", prazo: "26-04-2026" },
        owner,
      ),
    ).resolves.toMatchObject({
      titulo: "Ordem ajustada",
    });
    await expect(service.delete(10, owner)).resolves.toBeUndefined();

    expect(prisma.missoes.update).toHaveBeenCalled();
    expect(prisma.missoes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prazo: new Date("2026-04-26T00:00:00.000Z"),
        }),
      }),
    );
    expect(prisma.missoes.delete).toHaveBeenCalledWith({
      where: { missao_id: 10 },
    });
  });

  it("protects recurring occurrences from deletion and rescheduling while allowing other edits", async () => {
    const prisma = prismaMock();
    const occurrence = task({ recurrence_series_id: 21 });
    prisma.missoes.findFirst.mockResolvedValue(occurrence);
    prisma.missoes.update.mockResolvedValue(
      task({ recurrence_series_id: 21, titulo: "Instrução ajustada" }),
    );
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    await expect(service.delete(10, user())).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(10, { prazo: "26-04-2026" }, user()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(10, { titulo: "Instrução ajustada" }, user()),
    ).resolves.toMatchObject({ titulo: "Instrução ajustada" });

    expect(prisma.missoes.delete).not.toHaveBeenCalled();
    expect(prisma.missoes.update).toHaveBeenCalledTimes(1);
    expect(toTaskResponse(occurrence, user()).permissions.can_delete).toBe(false);
  });

  it("rejects updates to another user's task", async () => {
    const prisma = prismaMock();
    prisma.missoes.findFirst.mockResolvedValue(null);
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    await expect(
      service.update(
        10,
        { titulo: "Acesso indevido" },
        user({ usuario_id: 99 }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.missoes.update).not.toHaveBeenCalled();
  });

  it("creates a manual task with direct ownership and audit event", async () => {
    const prisma = prismaMock();
    const createdTask = task();
    const create = jest.fn().mockResolvedValue(createdTask);
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        auditoria_eventos: prisma.auditoria_eventos,
        missoes: { create, findUnique: prisma.missoes.findUnique },
      }),
    );
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    const result = await service.create(
      {
        titulo: " Revisar plano semanal ",
        instrucao: " Abrir relatório ",
        prazo: "25-04-2026",
        responsavel_id: 7,
        objetivo_id: null,
      },
      user(),
    );

    expect(result.missao_id).toBe(10);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titulo: "Revisar plano semanal",
        instrucao: "Abrir relatório",
        status: TASK_STATUS.pending,
        criada_por_id: 7,
        responsavel_id: 7,
        objetivo_id: null,
        recurrence_series_id: null,
      }),
    });
    expect(prisma.auditoria_eventos.create).toHaveBeenCalledWith({
      data: {
        missao_id: 10,
        usuario_id: 7,
        acao: "tarefa_criada",
        detalhes: "Tarefa 'Revisar plano semanal' criada.",
      },
    });
  });

  it("creates a recurrence series and materializes occurrences with series identity", async () => {
    const prisma = prismaMock();
    const createdTasks = [
      task({ missao_id: 10, prazo: new Date("2026-04-24T00:00:00.000Z") }),
      task({ missao_id: 11, prazo: new Date("2026-04-27T00:00:00.000Z") }),
      task({ missao_id: 12, prazo: new Date("2026-04-29T00:00:00.000Z") }),
      task({ missao_id: 13, prazo: new Date("2026-05-01T00:00:00.000Z") }),
      task({ missao_id: 14, prazo: new Date("2026-05-04T00:00:00.000Z") }),
      task({ missao_id: 15, prazo: new Date("2026-05-06T00:00:00.000Z") }),
    ];
    const series = {
      recurrence_series_id: 21,
      responsavel_id: 7,
      objetivo_id: 7,
      titulo: "Treinar escrita",
      instrucao: null,
      prioridade: 2,
      recurrence_weekdays: [0, 2, 4],
      start_date: new Date("2026-04-24T00:00:00.000Z"),
      termination_policy: "ate_objetivo",
      end_date: null,
      ativo: true,
      created_at: new Date("2026-04-24T12:00:00.000Z"),
      updated_at: new Date("2026-04-24T12:00:00.000Z"),
    };
    prisma.series_recorrencia.create.mockResolvedValue(series);
    prisma.missoes.createManyAndReturn.mockResolvedValue(createdTasks);
    prisma.objetivos.findFirst.mockResolvedValue({
      id: 7,
      usuario_id: 7,
      status: "ativo",
    });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        auditoria_eventos: prisma.auditoria_eventos,
        missoes: { createManyAndReturn: prisma.missoes.createManyAndReturn },
        series_recorrencia: prisma.series_recorrencia,
      }),
    );
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    const result = await service.create(
      {
        titulo: "Treinar escrita",
        prazo: "24-04-2026",
        objetivo_id: 7,
        responsavel_id: 7,
        recurrence_weekdays: [0, 2, 4],
        duration_type: "ate_objetivo",
      },
      user(),
    );

    expect(result.missao_id).toBe(10);
    expect(prisma.series_recorrencia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        objetivo_id: 7,
        recurrence_weekdays: [0, 2, 4],
        termination_policy: "ate_objetivo",
      }),
    });
    const occurrenceCall = prisma.missoes.createManyAndReturn.mock.calls[0][0];
    expect(
      occurrenceCall.data.map((item: { prazo: Date }) =>
        item.prazo.toISOString().slice(0, 10),
      ),
    ).toEqual([
      "2026-04-24",
      "2026-04-27",
      "2026-04-29",
      "2026-05-01",
      "2026-05-04",
      "2026-05-06",
    ]);
    expect(occurrenceCall.skipDuplicates).toBe(true);
    expect(occurrenceCall.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recurrence_series_id: 21,
        }),
      ]),
    );
  });

  it("builds the focus board as a read and keeps overdue tasks pending", async () => {
    const prisma = prismaMock();
    const overdue = task({
      missao_id: 10,
      prazo: new Date("2026-08-12T00:00:00.000Z"),
    });
    const todayTask = task({
      missao_id: 11,
      prazo: new Date("2026-08-13T00:00:00.000Z"),
    });
    prisma.missoes.findMany.mockResolvedValue([overdue, todayTask]);
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T12:00:00.000Z"));

    const firstBoard = await service.focusBoard(user());
    const secondBoard = await service.focusBoard(user());

    expect(firstBoard.action_tasks.map((item) => item.missao_id)).toEqual([11]);
    expect(firstBoard.daily_tasks.map((item) => item.missao_id)).toEqual([11]);
    expect(secondBoard).toEqual(firstBoard);
    expect(overdue).toMatchObject({
      status: TASK_STATUS.pending,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.missoes.update).not.toHaveBeenCalled();
    expect(prisma.auditoria_eventos.create).not.toHaveBeenCalled();
    expect(prisma.series_recorrencia.findMany).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("preserves completed tasks in history by allowing delete only while pending", async () => {
    const prisma = prismaMock();
    prisma.missoes.findFirst.mockResolvedValue(task({status:TASK_STATUS.completed}));
    const service = new TasksService(
      prisma as unknown as PrismaService,
      calendar,
    );

    await expect(service.delete(10, user())).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.missoes.delete).not.toHaveBeenCalled();
  });

  it("creates and edits links only to an active owned goal", async () => {
    const prisma = prismaMock();
    prisma.objetivos.findFirst.mockResolvedValue({
      id: 3,
      usuario_id: 7,
      status: "ativo",
    });
    prisma.missoes.findFirst.mockResolvedValue(task());
    prisma.missoes.create.mockResolvedValue(task({ objetivo_id: 3 }));
    prisma.missoes.update.mockResolvedValue(task({ objetivo_id: 3 }));
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    const service = new TasksService(prisma as never, calendar);
    await expect(
      service.create({ titulo: "Ordem do objetivo", objetivo_id: 3 }, user()),
    ).resolves.toMatchObject({ objetivo_id: 3 });
    await service.update(10, { objetivo_id: 3 }, user());
    expect(prisma.objetivos.findFirst).toHaveBeenCalledWith({
      where: { id: 3, usuario_id: 7, status: "ativo" },
    });
    expect(prisma.missoes.update).toHaveBeenCalledWith({
      where: { missao_id: 10 },
      data: { objetivos: { connect: { id: 3 } } },
      include: { serie_recorrencia: true },
    });
    prisma.objetivos.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ titulo: "Vínculo inválido", objetivo_id: 99 }, user()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.update(10, { objetivo_id: 99 }, user()),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.missoes.create).toHaveBeenCalledTimes(1);
    expect(prisma.missoes.update).toHaveBeenCalledTimes(1);
  });

  it("validates only a new goal association during task updates", async () => {
    const prisma = prismaMock();
    prisma.missoes.findFirst.mockResolvedValue(task({ objetivo_id: 3 }));
    prisma.missoes.update.mockImplementation(async ({ data }) =>
      task({
        ...data,
        objetivo_id:
          "objetivos" in data && data.objetivos && "connect" in data.objetivos
            ? data.objetivos.connect.id
            : data.objetivos && "disconnect" in data.objetivos
              ? null
              : 3,
      }),
    );
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const service = new TasksService(prisma as never, calendar);

    await expect(
      service.update(10, { titulo: "Editar vínculo existente" }, user()),
    ).resolves.toMatchObject({ objetivo_id: 3 });
    await expect(
      service.update(
        10,
        { titulo: "Reenviar vínculo existente", objetivo_id: 3 },
        user(),
      ),
    ).resolves.toMatchObject({ objetivo_id: 3 });
    expect(prisma.objetivos.findFirst).not.toHaveBeenCalled();

    prisma.objetivos.findFirst.mockResolvedValue({
      id: 4,
      usuario_id: 7,
      status: "ativo",
    });
    await expect(
      service.update(10, { objetivo_id: 4 }, user()),
    ).resolves.toMatchObject({ objetivo_id: 4 });
    expect(prisma.objetivos.findFirst).toHaveBeenCalledWith({
      where: { id: 4, usuario_id: 7, status: "ativo" },
    });

    prisma.objetivos.findFirst.mockResolvedValue(null);
    await expect(service.update(10, { objetivo_id: 99 }, user())).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.update(10, { objetivo_id: null }, user()),
    ).resolves.toMatchObject({ objetivo_id: null });
  });

  it("disconnects the goal without configuring recurrence on the occurrence", async () => {
    const prisma = prismaMock();
    prisma.missoes.findFirst.mockResolvedValue(
      task({ objetivo_id: 3, recurrence_series_id: 21 }),
    );
    prisma.missoes.update.mockResolvedValue(
      task({ recurrence_series_id: 21 }),
    );
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    const service = new TasksService(prisma as never, calendar);
    await service.update(10, { objetivo_id: null }, user());
    expect(prisma.objetivos.findFirst).not.toHaveBeenCalled();
    expect(prisma.missoes.update).toHaveBeenCalledWith({
      where: { missao_id: 10 },
      data: { objetivos: { disconnect: true } },
      include: { serie_recorrencia: true },
    });
  });

  it.each(["recurrence_weekdays", "recurrence_end_date", "duration_type"])(
    "rejects PATCH configuration %s instead of storing it on an occurrence",
    async (field) => {
      const prisma = prismaMock();
      prisma.missoes.findFirst.mockResolvedValue(task());
      const service = new TasksService(prisma as never, calendar);
      await expect(
        service.update(10, { titulo: "Ordem", [field]: null }, user()),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.missoes.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    { duration_type: "ate_objetivo", recurrence_weekdays: [0] },
    { duration_type: "ate_data", recurrence_weekdays: [0] },
    { duration_type: "sem_termino", recurrence_weekdays: [] },
    { duration_type: "sem_termino", recurrence_weekdays: [7] },
    {
      duration_type: "ate_data",
      recurrence_weekdays: [0],
      recurrence_end_date: "2026-08-30",
    },
  ])(
    "rejects invalid series configuration before writing: %j",
    async (configuration) => {
      const prisma = prismaMock();
      const service = new TasksService(prisma as never, calendar);
      await expect(
        service.create(
          { titulo: "Repetir", prazo: "2026-08-31", ...configuration },
          user(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["sem_termino", "ate_data"])(
    "creates %s recurrence without a goal using only series configuration",
    async (policy) => {
      const prisma = prismaMock();
      prisma.$transaction.mockImplementation(async (callback) =>
        callback(prisma),
      );
      prisma.series_recorrencia.create.mockImplementation(async ({ data }) => ({
        recurrence_series_id: 21,
        ...data,
      }));
      prisma.missoes.createManyAndReturn.mockImplementation(async ({ data }) =>
        data.map((item: object, index: number) =>
          task({ ...item, missao_id: 10 + index }),
        ),
      );
      const service = new TasksService(prisma as never, calendar);
      const result = await service.create(
        {
          titulo: "Repetir",
          prazo: "2026-08-31",
          recurrence_weekdays: [2, 0, 2],
          duration_type: policy,
          recurrence_end_date: policy === "ate_data" ? "2026-09-02" : null,
        },
        user(),
      );
      expect(result).toMatchObject({
        objetivo_id: null,
        recurrence_series_id: 21,
      });
      expect(prisma.objetivos.findFirst).not.toHaveBeenCalled();
      const dates =
        prisma.missoes.createManyAndReturn.mock.calls[0][0].data.map(
          (item: { prazo: Date }) => item.prazo.toISOString().slice(0, 10),
        );
      expect(dates).toEqual(
        policy === "ate_data"
          ? ["2026-08-31", "2026-09-02"]
          : ["2026-08-31", "2026-09-02", "2026-09-07", "2026-09-09"],
      );
      expect(prisma.auditoria_eventos.createMany).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["complete"] as const)(
    "records %s without modifying the goal or series",
    async (action) => {
      const prisma = prismaMock();
      prisma.missoes.findFirst.mockResolvedValue(
        task({ objetivo_id: 3, recurrence_series_id: 21 }),
      );
      prisma.missoes.update.mockImplementation(async ({ data }) =>
        task(data),
      );
      prisma.$transaction.mockImplementation(async (callback) =>
        callback(prisma),
      );
      const service = new TasksService(prisma as never, calendar);
      const result = await service[action](10, user());
      expect(result.status).toBe("CONCLUIDA");
      expect(result.completed_at).toEqual(
        action === "complete" ? expect.any(Date) : null,
      );
      expect(prisma.objetivos.findFirst).not.toHaveBeenCalled();
      expect(prisma.series_recorrencia.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditoria_eventos.create).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Derived unperformed task state", () => {
  it.each([
    ["2026-09-08", "PENDENTE", "NAO_REALIZADA"],
    ["2026-09-09", "PENDENTE", "PENDENTE"],
    ["2026-09-10", "PENDENTE", "PENDENTE"],
    ["2026-09-08", "CONCLUIDA", "CONCLUIDA"],
  ])("derives %s / %s without persisting a result", (date, status, expected) => {
    const record = task({prazo: new Date(date + "T00:00:00Z"),status})
    const response = toTaskResponse(record, user(), new Date("2026-09-09T15:00:00Z"))
    expect(response.status_code).toBe(expected)
    expect(record.status).toBe(status)
    expect(response).not.toHaveProperty("failed_at")
    expect(response.permissions).not.toHaveProperty("can_fail")
  })
  it("changes at local midnight and leaves undated tasks pending", () => {
    const record = task({prazo: new Date("2026-09-08T00:00:00Z")})
    expect(toTaskResponse(record, user(), new Date("2026-09-09T02:59:00Z")).status_code).toBe("PENDENTE")
    expect(toTaskResponse(record, user(), new Date("2026-09-09T03:00:00Z")).status_code).toBe("NAO_REALIZADA")
    expect(toTaskResponse(task({prazo:null}), user()).status_code).toBe("PENDENTE")
  })
})
