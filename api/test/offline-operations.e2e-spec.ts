import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { TokenService } from "../src/auth/token.service";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("offline operations on PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: number;
  let otherId: number;
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.pathname.includes("test")
    )
      throw new Error("Use um banco local de teste explícito.");
    process.env.DATABASE_URL = url;
    process.env.BUNKERMODE_AUTH_SECRET = "offline-operation-test-secret";
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const seed = randomUUID().slice(0, 8);
    const owner = await prisma.usuarios.create({
      data: {
        usuario: `offline-${seed}`,
        email: `offline-${seed}@example.test`,
        senha_hash: "unused",
        enabled_modules: ["tasks", "objectives", "finances"],
      },
    });
    const other = await prisma.usuarios.create({
      data: {
        usuario: `other-${seed}`,
        email: `other-${seed}@example.test`,
        senha_hash: "unused",
      },
    });
    userId = owner.usuario_id;
    otherId = other.usuario_id;
    const tokens = app.get(TokenService);
    token = tokens.generate({ sub: userId, email: owner.email, version: 0 });
    otherToken = tokens.generate({
      sub: otherId,
      email: other.email,
      version: 0,
    });
  });

  afterAll(async () => {
    if (userId && otherId)
      await prisma.usuarios.deleteMany({
        where: { usuario_id: { in: [userId, otherId] } },
      });
    await app.close();
  });

  const send = (credential: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post("/api/v2/offline/operations")
      .set("Authorization", `Bearer ${credential}`)
      .send(body);

  it("assigns one confirmed version to every occurrence changed by recurring link and unlink", async () => {
    const goal = await send(token, {
      operationId: randomUUID(), domain: "goal", action: "create", payload: { titulo: "Versões da série" },
    }).expect(201);
    const created = await send(token, {
      operationId: randomUUID(), domain: "task", action: "create",
      payload: { titulo: "Contribuição recorrente", recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6], duration_type: "sem_termino" },
    }).expect(201);
    const seriesId = created.body.recurrence.series_id;
    const before = "2026-01-01T00:00:00.000Z";
    await prisma.missoes.updateMany({
      where: { recurrence_series_id: seriesId }, data: { updated_at: new Date(before) },
    });
    const occurrences = await prisma.missoes.findMany({ where: { recurrence_series_id: seriesId } });
    expect(occurrences.length).toBeGreaterThan(1);
    const otherOccurrence = occurrences.find((item) => item.missao_id !== created.body.id)!;
    const linked = await send(token, {
      operationId: randomUUID(), domain: "task", action: "link", target: created.body.id,
      baseUpdatedAt: before, payload: { objetivo_id: goal.body.id },
    }).expect(201);
    const linkedRows = await prisma.missoes.findMany({ where: { recurrence_series_id: seriesId } });
    expect(linkedRows.every((item) => item.updated_at.toISOString() === linked.body.updated_at)).toBe(true);
    expect(linked.body.updated_at).not.toBe(before);
    await send(token, {
      operationId: randomUUID(), domain: "task", action: "complete", target: otherOccurrence.missao_id,
      baseUpdatedAt: before,
    }).expect(409);
    await send(token, {
      operationId: randomUUID(), domain: "task", action: "complete", target: otherOccurrence.missao_id,
      baseUpdatedAt: linked.body.updated_at,
    }).expect(201);
    const unlinked = await send(token, {
      operationId: randomUUID(), domain: "task", action: "unlink", target: created.body.id,
      baseUpdatedAt: linked.body.updated_at,
    }).expect(201);
    const unlinkedRows = await prisma.missoes.findMany({ where: { recurrence_series_id: seriesId } });
    expect(unlinkedRows.every((item) => item.updated_at.toISOString() === unlinked.body.updated_at)).toBe(true);
    expect(unlinkedRows.every((item) => item.objetivo_id === null)).toBe(true);
    await send(token, {
      operationId: randomUUID(), domain: "task", action: "update", target: created.body.id,
      baseUpdatedAt: unlinked.body.updated_at, payload: { titulo: "Histórico preservado" },
    }).expect(201);
  });

  it("switches an optional objective atomically for a recurring series and retains its execution/history", async () => {
    const goals = await Promise.all(["Direção antiga", "Direção nova"].map((titulo) => send(token, {
      operationId: randomUUID(), domain: "goal", action: "create", payload: { titulo },
    }).expect(201)));
    const created = await send(token, {
      operationId: randomUUID(), domain: "task", action: "create",
      payload: { titulo: "Mesma tarefa", objetivo_id: goals[0].body.id,
        recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6], duration_type: "sem_termino" },
    }).expect(201);
    const completed = await send(token, { operationId: randomUUID(), domain: "task", action: "complete",
      target: created.body.id, baseUpdatedAt: created.body.updated_at }).expect(201);
    const seriesId = created.body.recurrence.series_id;
    const before = await prisma.missoes.count({ where: { recurrence_series_id: seriesId } });
    const command = { operationId: randomUUID(), domain: "task", action: "link", target: created.body.id,
      baseUpdatedAt: completed.body.updated_at, payload: { objetivo_id: goals[1].body.id } };
    const switched = await send(token, command).expect(201);
    expect((await send(token, command).expect(201)).body).toEqual(switched.body);
    expect(switched.body).toMatchObject({ id: created.body.id, objetivo_id: goals[1].body.id,
      status: "CONCLUIDA", completed_at: completed.body.completed_at });
    expect(await prisma.missoes.count({ where: { recurrence_series_id: seriesId, objetivo_id: goals[1].body.id } })).toBe(before);
    expect(await prisma.series_recorrencia.findUnique({ where: { recurrence_series_id: seriesId } }))
      .toMatchObject({ objetivo_id: goals[1].body.id });
    expect(await prisma.objetivos.findUnique({ where: { id: goals[1].body.id } })).toMatchObject({ status: "ativo" });
    const unlinked = await send(token, { operationId: randomUUID(), domain: "task", action: "unlink",
      target: created.body.id, baseUpdatedAt: switched.body.updated_at }).expect(201);
    expect(unlinked.body.objetivo_id).toBeNull();
    expect(await prisma.missoes.count({ where: { recurrence_series_id: seriesId, objetivo_id: null } })).toBe(before);
    expect(await prisma.auditoria_eventos.count({ where: { missao_id: created.body.id, acao: "tarefa_concluida" } })).toBe(1);
  });

  it("preserves occurrence and completion event time across next-day synchronization and idempotent replay", async () => {
    const occurredAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const task = await send(token, {
      operationId: randomUUID(), domain: "task", action: "create",
      payload: { titulo: "Concluída ontem offline" },
    }).expect(201);
    const complete = {
      operationId: randomUUID(), domain: "task", action: "complete",
      target: task.body.id, baseUpdatedAt: task.body.updated_at,
      payload: { occurred_at: occurredAt },
    };
    const done = await send(token, complete).expect(201);
    expect(done.body.completed_at).toBe(occurredAt);
    expect((await send(token, complete).expect(201)).body).toEqual(done.body);
    const audit = await prisma.auditoria_eventos.findFirstOrThrow({
      where: { missao_id: task.body.id, acao: "tarefa_concluida" },
    });
    expect(audit.occurred_at?.toISOString()).toBe(occurredAt);
    expect(audit.criado_em.getTime()).toBeGreaterThan(Date.parse(occurredAt));
    const history = await request(app.getHttpServer())
      .get(`/api/v2/tarefas/${task.body.id}/historico`)
      .set("Authorization", `Bearer ${token}`).expect(200);
    expect(history.body.find((event: { acao: string }) => event.acao === "tarefa_concluida"))
      .toMatchObject({ occurred_at: occurredAt, criado_em: audit.criado_em.toISOString() });

    const tracker = await send(token, {
      operationId: randomUUID(), domain: "tracker", action: "create",
      payload: { titulo: "Observação independente" },
    }).expect(201);
    const occurrence = {
      operationId: randomUUID(), domain: "occurrence", action: "create",
      parentId: tracker.body.id, payload: { occurred_at: occurredAt },
    };
    const first = await send(token, occurrence).expect(201);
    expect(first.body.occurred_at).toBe(occurredAt);
    expect(Date.parse(first.body.created_at)).toBeGreaterThan(Date.parse(occurredAt));
    expect((await send(token, occurrence).expect(201)).body).toEqual(first.body);
    expect(await prisma.ocorrencias_acompanhamento.count({ where: { acompanhamento_id: tracker.body.id } })).toBe(1);
  });

  it("commits a normal task and its audit event once despite replay and concurrent requests", async () => {
    const operationId = randomUUID();
    const body = {
      operationId,
      domain: "task",
      action: "create",
      payload: { titulo: "Offline normal", prazo: "2026-10-02" },
    };
    const responses = await Promise.all([send(token, body), send(token, body)]);
    expect(responses.map((item) => item.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    const replay = await send(token, body).expect(201);
    expect(replay.body.id).toBe(responses[0].body.id);
    expect(
      await prisma.missoes.count({
        where: { titulo: "Offline normal", responsavel_id: userId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditoria_eventos.count({
        where: { missao_id: replay.body.id, acao: "tarefa_criada" },
      }),
    ).toBe(1);
    await send(token, { ...body, payload: { titulo: "Alterado" } }).expect(409);
    const other = await send(otherToken, body).expect(201);
    expect(other.body.id).not.toBe(replay.body.id);
    expect(
      await prisma.offlineOperation.count({ where: { operationId } }),
    ).toBe(2);
  });

  it("creates one recurring series on replay", async () => {
    const operationId = randomUUID();
    const body = {
      operationId,
      domain: "task",
      action: "create",
      payload: {
        titulo: "Recorrente offline",
        prazo: "2026-10-02",
        recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
        duration_type: "sem_termino",
      },
    };
    const first = await send(token, body).expect(201);
    const second = await send(token, body).expect(201);
    expect(first.body.recurrence.series_id).toBe(
      second.body.recurrence.series_id,
    );
    expect(
      await prisma.series_recorrencia.count({
        where: { titulo: "Recorrente offline", responsavel_id: userId },
      }),
    ).toBe(1);
  });

  it("deletes a linked recurring task through replay while retaining only completed occurrences and their audit", async () => {
    const goal = await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "create",
      payload: { titulo: "Direção preservada" },
    }).expect(201);
    const created = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "create",
      payload: {
        titulo: "Recorrência a excluir",
        objetivo_id: goal.body.id,
        recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
        duration_type: "ate_objetivo",
      },
    }).expect(201);
    const seriesId = created.body.recurrence.series_id;
    expect(created.body.permissions.can_delete).toBe(true);
    const board = await request(app.getHttpServer())
      .get("/api/v2/tarefas")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(
      board.body.filter(
        (t: { recurrence: { series_id: number } | null }) =>
          t.recurrence?.series_id === seriesId,
      ).length,
    ).toBeGreaterThan(1);
    await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "complete",
      target: created.body.id,
      baseUpdatedAt: created.body.updated_at,
      payload: {},
    }).expect(201);
    const history = await prisma.auditoria_eventos.findMany({
      where: { missao_id: created.body.id },
      orderBy: { evento_id: "asc" },
    });
    const pending = await prisma.missoes.findFirstOrThrow({
      where: { recurrence_series_id: seriesId, status: "PENDENTE" },
    });
    const body = {
      operationId: randomUUID(),
      domain: "task",
      action: "delete",
      target: pending.missao_id,
      baseUpdatedAt: pending.updated_at.toISOString(),
      payload: {},
    };
    await send(otherToken, body).expect(404);
    await send(token, body).expect(201);
    await send(token, body).expect(201);
    expect(
      await prisma.missoes.findMany({
        where: { recurrence_series_id: seriesId },
      }),
    ).toEqual([
      expect.objectContaining({
        missao_id: created.body.id,
        status: "CONCLUIDA",
      }),
    ]);
    expect(
      await prisma.auditoria_eventos.findMany({
        where: { missao_id: created.body.id },
        orderBy: { evento_id: "asc" },
      }),
    ).toEqual(history);
    expect(
      await prisma.series_recorrencia.findUniqueOrThrow({
        where: { recurrence_series_id: seriesId },
      }),
    ).toMatchObject({ ativo: false });
    expect(
      await prisma.objetivos.findUniqueOrThrow({ where: { id: goal.body.id } }),
    ).toMatchObject({ status: "ativo" });
    await request(app.getHttpServer())
      .post("/api/v2/tarefas/recorrencias/materializar")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    expect(
      await prisma.missoes.count({ where: { recurrence_series_id: seriesId } }),
    ).toBe(1);
    expect(
      await prisma.offlineOperation.count({
        where: { userId, operationId: body.operationId },
      }),
    ).toBe(1);
  });

  it("resolves goal, task, tracker and occurrence through official IDs with replay safety", async () => {
    const goalBody = {
      operationId: randomUUID(),
      domain: "goal",
      action: "create",
      payload: { titulo: "Objetivo offline" },
    };
    const goal = await send(token, goalBody).expect(201);
    expect((await send(token, goalBody).expect(201)).body.id).toBe(
      goal.body.id,
    );
    const task = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "create",
      payload: { titulo: "Tarefa vinculada", objetivo_id: goal.body.id },
    }).expect(201);
    expect(task.body.objetivo_id).toBe(goal.body.id);
    const trackerBody = {
      operationId: randomUUID(),
      domain: "tracker",
      action: "create",
      payload: { titulo: "Acompanhar", objetivo_id: goal.body.id },
    };
    const tracker = await send(token, trackerBody).expect(201);
    expect((await send(token, trackerBody).expect(201)).body.id).toBe(
      tracker.body.id,
    );
    const occurrenceBody = {
      operationId: randomUUID(),
      domain: "occurrence",
      action: "create",
      parentId: tracker.body.id,
      payload: {},
    };
    const event = await send(token, occurrenceBody).expect(201);
    expect((await send(token, occurrenceBody).expect(201)).body.id).toBe(
      event.body.id,
    );
    expect(
      await prisma.ocorrencias_acompanhamento.count({
        where: { acompanhamento_id: tracker.body.id },
      }),
    ).toBe(1);
    await send(otherToken, {
      operationId: randomUUID(),
      domain: "tracker",
      action: "update",
      target: tracker.body.id,
      baseUpdatedAt: tracker.body.updated_at,
      payload: { titulo: "Roubo" },
    }).expect(404);
  });

  it("detects conflicting versions and keeps financial cents idempotent", async () => {
    const goal = await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "create",
      payload: { titulo: "Conflito" },
    }).expect(201);
    const first = await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "update",
      target: goal.body.id,
      baseUpdatedAt: goal.body.updated_at,
      payload: { titulo: "Primeira edição" },
    }).expect(201);
    expect(first.body.titulo).toBe("Primeira edição");
    await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "update",
      target: goal.body.id,
      baseUpdatedAt: goal.body.updated_at,
      payload: { titulo: "Edição obsoleta" },
    }).expect(409);
    const entryBody = {
      operationId: randomUUID(),
      domain: "entry",
      action: "create",
      payload: {
        titulo: "Entrada offline",
        tipo: "receita",
        valor_centavos: 12345,
        data: "2026-01-01",
      },
    };
    const entry = await send(token, entryBody).expect(201);
    expect((await send(token, entryBody).expect(201)).body.id).toBe(
      entry.body.id,
    );
    expect(
      await prisma.lancamentos_financeiros.count({
        where: { titulo: "Entrada offline", usuario_id: userId },
      }),
    ).toBe(1);
    await send(token, {
      operationId: randomUUID(),
      domain: "entry",
      action: "create",
      payload: { ...entryBody.payload, valor_centavos: 1.5 },
    }).expect(400);
  });

  it("keeps task changes, pin state and completion history idempotent", async () => {
    const created = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "create",
      payload: { titulo: "Tarefa mutável" },
    }).expect(201);
    const pin = {
      operationId: randomUUID(),
      domain: "task",
      action: "pin",
      target: created.body.id,
      baseUpdatedAt: created.body.updated_at,
      payload: { is_pinned: true },
    };
    const pinned = await send(token, pin).expect(201);
    expect(pinned.body.is_pinned).toBe(true);
    expect((await send(token, pin).expect(201)).body.is_pinned).toBe(true);
    const goal = await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "create",
      payload: { titulo: "Vínculo da tarefa" },
    }).expect(201);
    const linked = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "link",
      target: created.body.id,
      baseUpdatedAt: pinned.body.updated_at,
      payload: { objetivo_id: goal.body.id },
    }).expect(201);
    expect(linked.body.objetivo_id).toBe(goal.body.id);
    const unlinked = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "unlink",
      target: created.body.id,
      baseUpdatedAt: linked.body.updated_at,
      payload: {},
    }).expect(201);
    expect(unlinked.body.objetivo_id).toBeNull();
    const completion = {
      operationId: randomUUID(),
      domain: "task",
      action: "complete",
      target: created.body.id,
      baseUpdatedAt: unlinked.body.updated_at,
      payload: {},
    };
    const done = await send(token, completion).expect(201);
    expect(done.body.status).toBe("CONCLUIDA");
    await send(token, completion).expect(201);
    expect(
      await prisma.auditoria_eventos.count({
        where: { missao_id: created.body.id, acao: "tarefa_concluida" },
      }),
    ).toBe(1);
    await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "complete",
      target: created.body.id,
      baseUpdatedAt: pinned.body.updated_at,
      payload: {},
    }).expect(409);
    const reopened = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "reopen",
      target: created.body.id,
      baseUpdatedAt: done.body.updated_at,
      payload: {},
    }).expect(201);
    expect(reopened.body.status).toBe("PENDENTE");
    const updated = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "update",
      target: created.body.id,
      baseUpdatedAt: reopened.body.updated_at,
      payload: { titulo: "Tarefa editada" },
    }).expect(201);
    expect(updated.body.titulo).toBe("Tarefa editada");
    await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "delete",
      target: created.body.id,
      baseUpdatedAt: updated.body.updated_at,
      payload: {},
    }).expect(201);
    expect(
      await prisma.missoes.count({ where: { missao_id: created.body.id } }),
    ).toBe(0);
  });

  it("replays tracker mutations without leaking ownership", async () => {
    const tracker = await send(token, {
      operationId: randomUUID(),
      domain: "tracker",
      action: "create",
      payload: { titulo: "Acompanhar mutações" },
    }).expect(201);
    const updated = await send(token, {
      operationId: randomUUID(),
      domain: "tracker",
      action: "update",
      target: tracker.body.id,
      baseUpdatedAt: tracker.body.updated_at,
      payload: { titulo: "Acompanhamento editado" },
    }).expect(201);
    expect(updated.body.titulo).toBe("Acompanhamento editado");
    const event = await send(token, {
      operationId: randomUUID(),
      domain: "occurrence",
      action: "create",
      parentId: tracker.body.id,
      payload: {},
    }).expect(201);
    const removeEvent = {
      operationId: randomUUID(),
      domain: "occurrence",
      action: "delete",
      target: event.body.id,
      parentId: tracker.body.id,
      payload: {},
    };
    await send(token, removeEvent).expect(201);
    await send(token, removeEvent).expect(201);
    expect(
      await prisma.ocorrencias_acompanhamento.count({
        where: { id: event.body.id },
      }),
    ).toBe(0);
    await send(otherToken, {
      operationId: randomUUID(),
      domain: "occurrence",
      action: "create",
      parentId: tracker.body.id,
      payload: {},
    }).expect(404);
  });

  it("replays goal status and deletion while preserving linked records", async () => {
    const goal = await send(token, {
      operationId: randomUUID(),
      domain: "goal",
      action: "create",
      payload: { titulo: "Objetivo removível" },
    }).expect(201);
    const task = await send(token, {
      operationId: randomUUID(),
      domain: "task",
      action: "create",
      payload: { titulo: "Tarefa preservada", objetivo_id: goal.body.id },
    }).expect(201);
    const tracker = await send(token, {
      operationId: randomUUID(),
      domain: "tracker",
      action: "create",
      payload: {
        titulo: "Acompanhamento preservado",
        objetivo_id: goal.body.id,
      },
    }).expect(201);
    const status = {
      operationId: randomUUID(),
      domain: "goal",
      action: "status",
      target: goal.body.id,
      baseUpdatedAt: goal.body.updated_at,
      payload: { status: "pausado" },
    };
    const paused = await send(token, status).expect(201);
    expect(paused.body.status).toBe("pausado");
    expect((await send(token, status).expect(201)).body.status).toBe("pausado");
    await send(otherToken, {
      operationId: randomUUID(),
      domain: "goal",
      action: "delete",
      target: goal.body.id,
      baseUpdatedAt: paused.body.updated_at,
      payload: {},
    }).expect(404);
    const deletion = {
      operationId: randomUUID(),
      domain: "goal",
      action: "delete",
      target: goal.body.id,
      baseUpdatedAt: paused.body.updated_at,
      payload: {},
    };
    await send(token, deletion).expect(201);
    await send(token, deletion).expect(201);
    expect(await prisma.objetivos.count({ where: { id: goal.body.id } })).toBe(
      0,
    );
    expect(
      (await prisma.missoes.findUnique({ where: { missao_id: task.body.id } }))
        ?.objetivo_id,
    ).toBeNull();
    expect(
      (
        await prisma.acompanhamentos.findUnique({
          where: { id: tracker.body.id },
        })
      )?.objetivo_id,
    ).toBeNull();
  });
});
