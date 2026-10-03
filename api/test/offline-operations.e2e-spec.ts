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
        categoria: "Outros",
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

  it("replays tracker and reserve mutations without leaking ownership", async () => {
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
    const reserve = {
      operationId: randomUUID(),
      domain: "reserve",
      action: "create",
      payload: { titulo: "Reserva idempotente", valor_centavos: 500 },
    };
    const first = await send(token, reserve).expect(201);
    expect((await send(token, reserve).expect(201)).body.id).toBe(
      first.body.id,
    );
    expect(
      await prisma.reservas_financeiras.count({
        where: { titulo: "Reserva idempotente", usuario_id: userId },
      }),
    ).toBe(1);
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
    const reserve = await send(token, {
      operationId: randomUUID(),
      domain: "reserve",
      action: "create",
      payload: {
        titulo: "Reserva preservada",
        objetivo_id: goal.body.id,
        valor_centavos: 0,
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
    expect(
      (
        await prisma.reservas_financeiras.findUnique({
          where: { id: reserve.body.id },
        })
      )?.objetivo_id,
    ).toBeNull();
  });
});
