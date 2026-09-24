import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../src/app.module";
import { hashPassword } from "../src/auth/password";
import { TASK_STATUS } from "../src/tasks/task.types";
import { PrismaService } from "../src/prisma/prisma.service";

type UserRow = {
  usuario_id: number;
  usuario: string;
  email: string;
  senha_hash: string;
  auth_version: number;
  ativo: boolean;
  enabled_modules: string[];
  timezone: string;
  created_at: Date;
  updated_at: Date;
};

type TaskRow = {
  missao_id: number;
  titulo: string;
  prioridade: number;
  prazo: Date | null;
  instrucao: string | null;
  status: string;
  is_pinned: boolean;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;

  recurrence_series_id: number | null;
  criada_por_id: number;
  responsavel_id: number;
  objetivo_id: number | null;
};

type RecurrenceSeriesRow = {
  recurrence_series_id: number;
  responsavel_id: number;
  objetivo_id: number | null;
  titulo: string;
  instrucao: string | null;
  prioridade: number;
  recurrence_weekdays: number[];
  start_date: Date;
  termination_policy: string;
  end_date: Date | null;
  ativo: boolean;
  created_at: Date;
  updated_at: Date;
};

type GoalRow = {
  id: number;
  usuario_id: number;
  titulo: string;
  descricao: string | null;
  data_alvo: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  concluded_at: Date | null;
  order_index: number;
};

class InMemoryPrisma {
  private userId = 1;
  private taskId = 1;
  private eventId = 1;
  private goalId = 1;
  private recurrenceSeriesId = 1;
  readonly users: UserRow[] = [];
  readonly tasks: TaskRow[] = [];
  readonly goals: GoalRow[] = [];
  readonly recurrenceSeries: RecurrenceSeriesRow[] = [];
  readonly events: Array<{
    evento_id: number;
    missao_id: number | null;
    usuario_id: number | null;
    acao: string;
    detalhes: string;
    criado_em: Date;
  }> = [];

  readonly usuarios = {
    create: async ({
      data,
    }: {
      data: Pick<UserRow, "usuario" | "email" | "senha_hash">;
    }) => {
      const now = new Date();
      const user: UserRow = {
        usuario_id: this.userId++,
        usuario: data.usuario,
        email: data.email,
        senha_hash: data.senha_hash,
        auth_version: 0,
        ativo: true,
        enabled_modules: ["tasks", "objectives"],
        timezone: "America/Recife",
        created_at: now,
        updated_at: now,
      };
      this.users.push(user);
      return user;
    },
    findUnique: async ({
      where,
    }: {
      where: Partial<Pick<UserRow, "usuario_id" | "usuario" | "email">>;
    }) =>
      this.users.find(
        (user) =>
          (where.usuario_id !== undefined &&
            user.usuario_id === where.usuario_id) ||
          (where.usuario !== undefined && user.usuario === where.usuario) ||
          (where.email !== undefined && user.email === where.email),
      ) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { usuario_id: number };
      data: Pick<UserRow, "enabled_modules">;
    }) => {
      const user = this.users.find((item) => item.usuario_id === where.usuario_id);
      if (!user) {
        throw new Error("User not found");
      }
      Object.assign(user, data, { updated_at: new Date() });
      return user;
    },
  };

  readonly missoes = {
    create: async ({
      data,
    }: {
      data: Partial<TaskRow> &
        Pick<
          TaskRow,
          "titulo" | "status" | "criada_por_id" | "responsavel_id"
        >;
    }) => {
      const now = new Date();
      const task: TaskRow = {
        missao_id: this.taskId++,
        titulo: data.titulo,
        prioridade: data.prioridade ?? 2,
        prazo: data.prazo ?? null,
        instrucao: data.instrucao ?? null,
        status: data.status,
        is_pinned: data.is_pinned ?? false,
        created_at: now,
        updated_at: now,
        completed_at: data.completed_at ?? null,

        recurrence_series_id: data.recurrence_series_id ?? null,
        criada_por_id: data.criada_por_id,
        responsavel_id: data.responsavel_id,
        objetivo_id: data.objetivo_id ?? null,
      };
      this.tasks.push(task);
      return task;
    },
    createManyAndReturn: async ({
      data,
      skipDuplicates,
    }: {
      data: Array<
        Partial<TaskRow> &
          Pick<
            TaskRow,
            "titulo" | "status" | "criada_por_id" | "responsavel_id"
          >
      >;
      skipDuplicates?: boolean;
    }) => {
      const created: TaskRow[] = [];
      for (const item of data) {
        const duplicate = this.tasks.some(
          (task) =>
            item.recurrence_series_id !== null &&
            item.recurrence_series_id !== undefined &&
            task.recurrence_series_id === item.recurrence_series_id &&
            task.prazo?.getTime() === item.prazo?.getTime(),
        );
        if (duplicate && skipDuplicates) {
          continue;
        }
        created.push(await this.missoes.create({ data: item }));
      }
      return created;
    },
    findMany: async ({
      where,
      include,
    }: {
      where?: {
        responsavel_id?: number;
        status?: string;
        prazo?: { lt: Date };
      };
      include?: { serie_recorrencia?: boolean };
    } = {}) => {
      let tasks = [...this.tasks];
      if (where?.responsavel_id !== undefined) {
        tasks = tasks.filter(
          (task) => task.responsavel_id === where.responsavel_id,
        );
      }
      if (where?.status !== undefined) {
        tasks = tasks.filter(
          (task) => task.status === where.status,
        );
      }
      if (where?.prazo?.lt) {
        tasks = tasks.filter(
          (task) =>
            task.prazo !== null && task.prazo < where.prazo!.lt,
        );
      }
      return tasks.map((task) =>
        include?.serie_recorrencia
          ? {
              ...task,
              serie_recorrencia:
                this.recurrenceSeries.find(
                  (series) =>
                    series.recurrence_series_id ===
                    task.recurrence_series_id,
                ) ?? null,
            }
          : task,
      );
    },
    findFirst: async ({
      where,
    }: {
      where: { missao_id?: number; responsavel_id?: number };
    }) =>
      this.tasks.find(
        (task) =>
          (where.missao_id === undefined ||
            task.missao_id === where.missao_id) &&
          (where.responsavel_id === undefined ||
            task.responsavel_id === where.responsavel_id),
      ) ?? null,
    findUnique: async ({ where }: { where: { missao_id?: number } }) =>
      this.tasks.find(
        (task) =>
          where.missao_id !== undefined &&
          task.missao_id === where.missao_id,
      ) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { missao_id: number };
      data: Partial<TaskRow>;
    }) => {
      const task = this.tasks.find(
        (item) => item.missao_id === where.missao_id,
      );
      if (!task) {
        throw new Error("Task not found");
      }
      Object.assign(task, data, { updated_at: new Date() });
      return task;
    },
    delete: async ({ where }: { where: { missao_id: number } }) => {
      const index = this.tasks.findIndex(
        (task) => task.missao_id === where.missao_id,
      );
      if (index >= 0) {
        this.tasks.splice(index, 1);
      }
    },
  };

  readonly auditoria_eventos = {
    create: async ({
      data,
    }: {
      data: {
        missao_id: number | null;
        usuario_id: number | null;
        acao: string;
        detalhes: string;
      };
    }) => {
      const event = {
        evento_id: this.eventId++,
        criado_em: new Date(),
        ...data,
      };
      this.events.push(event);
      return event;
    },
    createMany: async ({
      data,
    }: {
      data: Array<{
        missao_id: number | null;
        usuario_id: number | null;
        acao: string;
        detalhes: string;
      }>;
    }) => {
      for (const item of data) {
        await this.auditoria_eventos.create({ data: item });
      }
      return { count: data.length };
    },
    deleteMany: async ({ where }: { where: { missao_id: number } }) => {
      for (let index = this.events.length - 1; index >= 0; index -= 1) {
        if (this.events[index].missao_id === where.missao_id) {
          this.events.splice(index, 1);
        }
      }
    },
    findMany: async ({ where }: { where: { missao_id: number } }) =>
      this.events.filter((event) => event.missao_id === where.missao_id),
  };

  readonly series_recorrencia = {
    create: async ({
      data,
    }: {
      data: Omit<
        RecurrenceSeriesRow,
        "recurrence_series_id" | "created_at" | "updated_at"
      >;
    }) => {
      const now = new Date();
      const series: RecurrenceSeriesRow = {
        recurrence_series_id: this.recurrenceSeriesId++,
        created_at: now,
        updated_at: now,
        ...data,
      };
      this.recurrenceSeries.push(series);
      return series;
    },
    findMany: async ({
      where,
      include,
    }: {
      where: { responsavel_id: number; ativo: boolean };
      include?: { objetivos?: boolean };
    }) =>
      this.recurrenceSeries
        .filter(
          (series) =>
            series.responsavel_id === where.responsavel_id &&
            series.ativo === where.ativo,
        )
        .map((series) =>
          include?.objetivos
            ? {
                ...series,
                objetivos:
                  this.goals.find((goal) => goal.id === series.objetivo_id) ??
                  null,
              }
            : series,
        ),
    updateMany: async ({
      where,
      data,
    }: {
      where: Partial<RecurrenceSeriesRow>;
      data: Partial<RecurrenceSeriesRow>;
    }) => {
      const matching = this.recurrenceSeries.filter(
        (series) =>
          (where.recurrence_series_id === undefined ||
            series.recurrence_series_id === where.recurrence_series_id) &&
          (where.objetivo_id === undefined ||
            series.objetivo_id === where.objetivo_id) &&
          (where.termination_policy === undefined ||
            series.termination_policy === where.termination_policy) &&
          (where.ativo === undefined || series.ativo === where.ativo),
      );
      matching.forEach((series) =>
        Object.assign(series, data, { updated_at: new Date() }),
      );
      return { count: matching.length };
    },
  };

  readonly objetivos = {
    delete: async ({ where }: { where: { id: number } }) => {
      const index = this.goals.findIndex((goal) => goal.id === where.id);
      if (index < 0) throw new Error("Goal not found");
      this.goals.splice(index, 1);
      this.tasks
        .filter((task) => task.objetivo_id === where.id)
        .forEach((task) => {
          task.objetivo_id = null;
        });
      this.recurrenceSeries
        .filter((series) => series.objetivo_id === where.id)
        .forEach((series) => {
          series.objetivo_id = null;
        });
    },
    aggregate: async ({ where }: { where: { usuario_id: number } }) => {
      const orderIndexes = this.goals
        .filter((goal) => goal.usuario_id === where.usuario_id)
        .map((goal) => goal.order_index);
      return {
        _max: {
          order_index: orderIndexes.length ? Math.max(...orderIndexes) : null,
        },
      };
    },
    create: async ({
      data,
    }: {
      data: Partial<GoalRow> &
        Pick<GoalRow, "usuario_id" | "titulo" | "status">;
    }) => {
      const now = new Date();
      const goal: GoalRow = {
        id: this.goalId++,
        usuario_id: data.usuario_id,
        titulo: data.titulo,
        descricao: data.descricao ?? null,
        data_alvo: data.data_alvo ?? null,
        status: data.status,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        concluded_at: data.concluded_at ?? null,
        order_index: data.order_index ?? 1,
      };
      this.goals.push(goal);
      return goal;
    },
    findFirst: async ({
      where,
    }: {
      where: { id?: number; usuario_id?: number; status?: string };
    }) => {
      const goal =
        this.goals.find(
          (item) =>
            (where.id === undefined || item.id === where.id) &&
            (where.usuario_id === undefined ||
              item.usuario_id === where.usuario_id) &&
            (where.status === undefined || item.status === where.status),
        ) ?? null;
      if (!goal) {
        return null;
      }
      return goal;
    },
    findMany: async ({
      where,
    }: { where?: { usuario_id?: number; id?: { in: number[] } } } = {}) => {
      let goals = [...this.goals];
      if (where?.usuario_id !== undefined) {
        goals = goals.filter((goal) => goal.usuario_id === where.usuario_id);
      }
      if (where?.id?.in) {
        goals = goals.filter((goal) => where.id!.in.includes(goal.id));
      }
      return goals.sort(
        (left, right) =>
          left.order_index - right.order_index || left.id - right.id,
      );
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: number };
      data: Partial<GoalRow>;
    }) => {
      const goal = this.goals.find((item) => item.id === where.id);
      if (!goal) {
        throw new Error("Goal not found");
      }
      Object.assign(goal, data, { updated_at: new Date() });
      return goal;
    },
  };

  async $transaction<T>(
    operation: Promise<T>[] | ((tx: this) => Promise<T>),
  ): Promise<T | T[]> {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }
    return operation(this);
  }

  async $queryRaw(): Promise<Array<{ "?column?": number }>> {
    return [{ "?column?": 1 }];
  }

  async $disconnect(): Promise<void> {}
}

describe("HTTP application", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.BUNKERMODE_AUTH_SECRET = "http-test-secret";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(new InMemoryPrisma())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responds to health checks", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok" });
    await request(app.getHttpServer())
      .get("/api/v2/health")
      .expect(200)
      .expect({ status: "ok" });
  });

  it("rejects protected endpoints without token", async () => {
    await request(app.getHttpServer()).get("/api/v2/usuarios/me").expect(401);
    await request(app.getHttpServer()).get("/api/v2/acompanhamentos").expect(401);
    await request(app.getHttpServer()).post("/api/v2/acompanhamentos/1/ocorrencias").expect(401);
    await request(app.getHttpServer()).post("/api/v2/tarefas/1/desvincular-objetivo").expect(401);
  });

  it("reopens completed tasks through an authenticated audited command", async () => {
    const server = app.getHttpServer();
    await app.get(PrismaService).usuarios.create({ data: { usuario: "reabertura", email: "reabertura@bunker.local", senha_hash: hashPassword("senha1234") } });
    const login = await request(server).post("/api/v2/auth/login").send({ email: "reabertura", senha: "senha1234" }).expect(200);
    const authorization = `Bearer ${login.body.access_token}`;
    await request(server).post("/api/v2/tarefas/1/reabrir").expect(401);
    await request(server).post("/api/v2/tarefas/999999/reabrir").set("Authorization", authorization).expect(404);
    for (const action of ["concluir"]) {
      const created = await request(server).post("/api/v2/tarefas").set("Authorization", authorization).send({ titulo: `Reabrir ${action}` }).expect(201);
      const path = `/api/v2/tarefas/${created.body.id}`;
      await request(server).post(`${path}/reabrir`).set("Authorization", authorization).expect(400);
      const result = await request(server).patch(`${path}/concluir`).set("Authorization", authorization).expect(200);
      expect(result.body.permissions.can_reopen).toBe(true);
      await request(server).patch(path).set("Authorization", authorization).send({ status: "PENDENTE" }).expect(400);
      const reopened = await request(server).post(`${path}/reabrir`).set("Authorization", authorization).expect(200);
      expect(reopened.body).toMatchObject({ status: "PENDENTE", completed_at: null, permissions: { can_reopen: false, can_complete: true } });
      const history = await request(server).get(`${path}/historico`).set("Authorization", authorization).expect(200);
      expect(history.body.map((event: { acao: string }) => event.acao)).toEqual(["tarefa_criada", action === "concluir" ? "tarefa_concluida" : "tarefa_nao_realizada", "tarefa_reaberta"]);
    }
  });

  it("keeps task GETs read-only and materializes only through the authenticated command", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    try {
      await request(app.getHttpServer()).post("/api/v2/auth/register")
        .send({ usuario: "leitura", email: "leitura@bunker.local", senha: "senha1234" })
        .expect(201);
      const login = await request(app.getHttpServer()).post("/api/v2/auth/login")
        .send({ email: "leitura", senha: "senha1234" }).expect(200);
      const authorization = `Bearer ${login.body.access_token}`;
      const prisma = app.get(PrismaService) as unknown as InMemoryPrisma;
      const owner = prisma.users.find((user) => user.usuario === "leitura")!;
      const overdue = await prisma.missoes.create({
        data: {
          titulo: "Tarefa atrasada", status: "PENDENTE",
          prazo: new Date("2026-08-12T00:00:00.000Z"),
          criada_por_id: owner.usuario_id, responsavel_id: owner.usuario_id,
        },
      });
      await prisma.series_recorrencia.create({
        data: {
          titulo: "Recorrência sem ocorrências", responsavel_id: owner.usuario_id,
          objetivo_id: null, instrucao: null, prioridade: 2,
          recurrence_weekdays: [3], start_date: new Date("2026-08-13T00:00:00.000Z"),
          termination_policy: "sem_termino", end_date: null, ativo: true,
        },
      });
      const snapshot = () => JSON.stringify({
        tasks: prisma.tasks, events: prisma.events, series: prisma.recurrenceSeries,
      });
      const before = snapshot();
      for (let iteration = 0; iteration < 2; iteration += 1) {
        for (const path of ["tarefas", "tarefas/dia-operacional", "tarefas/foco",
          "tarefas/historico", `tarefas/${overdue.missao_id}/historico`]) {
          await request(app.getHttpServer()).get(`/api/v2/${path}`)
            .set("Authorization", authorization).expect(200);
        }
        expect(snapshot()).toBe(before);
      }
      await request(app.getHttpServer())
        .post("/api/v2/tarefas/recorrencias/materializar").expect(401);
      expect(snapshot()).toBe(before);
      const materialize = () => request(app.getHttpServer())
        .post("/api/v2/tarefas/recorrencias/materializar")
        .set("Authorization", authorization).expect(204);
      await materialize();
      const ownedTasks = prisma.tasks.filter((task) => task.responsavel_id === owner.usuario_id);
      expect(ownedTasks.map((task) => task.prazo?.toISOString().slice(0, 10)))
        .toEqual(["2026-08-12", "2026-08-13", "2026-08-20"]);
      expect(ownedTasks.every((task) => task.status === "PENDENTE")).toBe(true);
      expect(prisma.events.filter((event) => event.usuario_id === owner.usuario_id)
        .map((event) => event.acao)).toEqual(["tarefa_recorrente_criada", "tarefa_recorrente_criada"]);
      const after = snapshot();
      await materialize();
      const focus = await request(app.getHttpServer()).get("/api/v2/tarefas/foco")
        .set("Authorization", authorization).expect(200);
      expect(focus.body.tasks).toHaveLength(1);
      expect(snapshot()).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns the domain error contract for invalid payloads", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v2/auth/register")
      .send({ usuario: "x" })
      .expect(400);

    expect(response.body).toMatchObject({
      message: "Usuário deve ter entre 3 e 32 caracteres.",
    });
  });

  it("registers, logs in, reads the authenticated user and executes a task flow", async () => {
    const publicUserKeys = [
      "id", "usuario", "email", "enabled_modules", "timezone", "created_at", "updated_at", "ativo",
    ].sort();
    await request(app.getHttpServer())
      .post("/api/v2/auth/register")
      .send({
        usuario: "usuario-teste",
        email: "usuario-teste@bunker.local",
        senha: "senha1234",
      })
      .expect(201)
      .expect((response) => {
        expect(Object.keys(response.body).sort()).toEqual(publicUserKeys);
      });

    const login = await request(app.getHttpServer())
      .post("/api/v2/auth/login")
      .send({ email: "usuario-teste", senha: "senha1234" })
      .expect(200);
    const token = login.body.access_token;
    expect(login.body.usuario.enabled_modules).toEqual(["tasks", "objectives"]);
    expect(Object.keys(login.body.usuario).sort()).toEqual(
      publicUserKeys.filter((key) => key !== "ativo"),
    );

    await request(app.getHttpServer())
      .get("/api/v2/usuarios/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.usuario).toBe("usuario-teste");
        expect(response.body.enabled_modules).toEqual(["tasks", "objectives"]);
        expect(Object.keys(response.body).sort()).toEqual(publicUserKeys);
      });

    await request(app.getHttpServer())
      .patch("/api/v2/usuarios/me/modulos")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled_modules: ["tasks"] })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          usuario: "usuario-teste",
          email: "usuario-teste@bunker.local",
          enabled_modules: ["tasks"],
          timezone: "America/Recife",
          ativo: true,
        });
      });

    const created = await request(app.getHttpServer())
      .post("/api/v2/tarefas")
      .set("Authorization", `Bearer ${token}`)
      .send({ titulo: "Revisar planejamento", prazo: "2026-08-13" })
      .expect(201);
    expect(created.body).toMatchObject({
      titulo: "Revisar planejamento",
      status: TASK_STATUS.pending,
    });

    await request(app.getHttpServer())
      .get("/api/v2/tarefas")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .patch(`/api/v2/tarefas/${created.body.id}/concluir`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe(TASK_STATUS.completed);
      });

    await request(app.getHttpServer())
      .get("/api/v2/tarefas")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.body.id,
              status: TASK_STATUS.completed,
            }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .get(`/api/v2/tarefas/${created.body.id}/historico`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((response) => {
        expect(
          response.body.map((event: { acao: string }) => event.acao),
        ).toEqual(["tarefa_criada", "tarefa_concluida"]);
        for (const event of response.body as Array<{
          tarefa_id: number;
          missao_id?: number;
        }>) {
          expect(Object.keys(event).sort()).toEqual([
            "acao",
            "criado_em",
            "detalhes",
            "id",
            "tarefa_id",
            "usuario_id",
          ]);
          expect(event.tarefa_id).toBe(created.body.id);
          expect(event).not.toHaveProperty("missao_id");
        }
      });
  });

  it("preserves authenticated access and ownership across protected resources", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    try {
      await request(app.getHttpServer())
        .post("/api/v2/auth/register")
        .send({
          usuario: "preferencia",
          email: "preferencia@bunker.local",
          senha: "senha1234",
        })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post("/api/v2/auth/login")
        .send({ email: "preferencia", senha: "senha1234" })
        .expect(200);
      const token = login.body.access_token;

      const original = await request(app.getHttpServer())
        .post("/api/v2/tarefas")
        .set("Authorization", `Bearer ${token}`)
        .send({ titulo: "Ordem original", prazo: "2026-09-01" })
        .expect(201);

      const taskList = await request(app.getHttpServer())
        .get("/api/v2/tarefas")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get("/api/v2/tarefas/foco")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(
            response.body.tasks.map((task: { id: number }) => task.id),
          ).toContain(original.body.id);
        });

      expect(taskList.body.map((task: { id: number }) => task.id)).toContain(original.body.id);

      const created = await request(app.getHttpServer())
        .post("/api/v2/tarefas")
        .set("Authorization", `Bearer ${token}`)
        .send({ titulo: "Tarefa criada pelo usuário", prazo: "2026-09-01" })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v2/tarefas/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ titulo: "Tarefa editada pelo usuário" })
        .expect(200)
        .expect((response) => {
          expect(response.body.titulo).toBe("Tarefa editada pelo usuário");
        });

      const objective = await request(app.getHttpServer())
        .post("/api/v2/objetivos")
        .set("Authorization", `Bearer ${token}`)
        .send({ titulo: "Objetivo criado pelo usuário" })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v2/objetivos/${objective.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ titulo: "Objetivo editado pelo usuário" })
        .expect(200)
        .expect((response) => {
          expect(response.body.titulo).toBe("Objetivo editado pelo usuário");
        });

      await request(app.getHttpServer())
        .post("/api/v2/auth/register")
        .send({
          usuario: "intruso",
          email: "intruso@bunker.local",
          senha: "senha1234",
        })
        .expect(201);
      const foreignLogin = await request(app.getHttpServer())
        .post("/api/v2/auth/login")
        .send({ email: "intruso", senha: "senha1234" })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v2/tarefas/${original.body.id}`)
        .set("Authorization", `Bearer ${foreignLogin.body.access_token}`)
        .send({ titulo: "Tentativa indevida" })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v2/tarefas/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get("/api/v2/usuarios/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({
            usuario: "preferencia",
            timezone: "America/Recife",
          });
        });
    } finally {
      jest.useRealTimers();
    }
  });

  it("executes independent goals, recurring orders and objective history over HTTP", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    try {
      await request(app.getHttpServer())
        .post("/api/v2/auth/register")
        .send({
          usuario: "planejador",
          email: "planejador@bunker.local",
          senha: "senha1234",
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post("/api/v2/auth/login")
        .send({ email: "planejador", senha: "senha1234" })
        .expect(200);
      const token = login.body.access_token;
      const authorization = `Bearer ${token}`;
      const objective = await request(app.getHttpServer())
        .post("/api/v2/objetivos")
        .set("Authorization", authorization)
        .send({ titulo: "Consolidar escrita" })
        .expect(201);
      expect(Object.keys(objective.body).sort()).toEqual(
        [
          "id",
          "usuario_id",
          "titulo",
          "descricao",
          "data_alvo",
          "status",
          "order_index",
          "created_at",
          "updated_at",
          "concluded_at",
        ].sort(),
      );
      expect(objective.body).toMatchObject({
        status: "ativo",
        data_alvo: null,
        order_index: 1,
      });

      const recurring = await request(app.getHttpServer())
        .post("/api/v2/tarefas")
        .set("Authorization", authorization)
        .send({
          titulo: "Escrever",
          prazo: "2026-08-13",
          objetivo_id: objective.body.id,
          recurrence_weekdays: [3],
          duration_type: "ate_objetivo",
        })
        .expect(201);
      expect(recurring.body.recurrence).toMatchObject({
        weekdays: [3],
        termination_policy: "ate_objetivo",
      });
      await request(app.getHttpServer())
        .post("/api/v2/tarefas/recorrencias/materializar")
        .set("Authorization", authorization)
        .expect(204);
      expect(Object.keys(recurring.body).sort()).toEqual(
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

      const board = () =>
        request(app.getHttpServer())
          .get("/api/v2/tarefas/foco")
          .set("Authorization", authorization)
          .expect(200);
      const firstBoard = await board();
      const secondBoard = await board();
      expect(secondBoard.body).toEqual(firstBoard.body);
      expect(
        firstBoard.body.tasks.map((task: { id: number }) => task.id),
      ).toContain(recurring.body.id);
      expect(firstBoard.body.tasks[0].recurrence).toMatchObject({
        series_id: recurring.body.recurrence.series_id,
      });

      await request(app.getHttpServer())
        .patch(`/api/v2/tarefas/${recurring.body.id}/concluir`)
        .set("Authorization", authorization)
        .expect(200);
      const pending = await request(app.getHttpServer())
        .post("/api/v2/tarefas")
        .set("Authorization", authorization)
        .send({ titulo: "Ordem independente", prazo: "2026-08-13" })
        .expect(201);
      expect(pending.body).toMatchObject({
        objetivo_id: null,
        recurrence: null,
      });
      await request(app.getHttpServer()).post(`/api/v2/tarefas/${pending.body.id}/falhar`).set("Authorization", authorization).expect(404);
      const history = await request(app.getHttpServer()).get("/api/v2/tarefas/historico").set("Authorization", authorization).expect(200);
      expect(history.body.some((task: { status: string }) => task.status === "CONCLUIDA")).toBe(true);
      const goals = await request(app.getHttpServer())
        .get("/api/v2/objetivos")
        .set("Authorization", authorization)
        .expect(200);
      expect(goals.body[0]).toMatchObject({
        status: "ativo",
        concluded_at: null,
      });
      await request(app.getHttpServer())
        .delete(`/api/v2/objetivos/${objective.body.id}`)
        .set("Authorization", authorization)
        .expect(204);
      const afterDelete = await request(app.getHttpServer())
        .get("/api/v2/tarefas/historico")
        .set("Authorization", authorization)
        .expect(200);
      expect(afterDelete.body).toHaveLength(1);
      expect(
        afterDelete.body.every(
          (task: { objetivo_id: number | null }) =>
            task.objetivo_id === null,
        ),
      ).toBe(true);
      await request(app.getHttpServer())
        .get(`/api/v2/tarefas/${recurring.body.id}/historico`)
        .set("Authorization", authorization)
        .expect(200)
        .expect((response) => {
          expect(
            response.body.map((event: { acao: string }) => event.acao),
          ).toEqual(["tarefa_recorrente_criada", "tarefa_concluida"]);
        });
    } finally {
      jest.useRealTimers();
    }
  });
});
