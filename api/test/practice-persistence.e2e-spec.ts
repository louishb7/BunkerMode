import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { TokenService } from "../src/auth/token.service";
import { UserRecord } from "../src/auth/auth.types";
import {
  addPracticeDays,
  derivePractice,
  practiceDate,
  practicePlanSignature,
} from "../src/goals/practice-domain";

const url = process.env.TEST_DATABASE_URL;
const withDatabase = url ? describe : describe.skip;
const previousUrl = process.env.DATABASE_URL;
const previousSecret = process.env.BUNKERMODE_AUTH_SECRET;

withDatabase("Práticas no PostgreSQL e replay HTTP", () => {
  let app: INestApplication,
    prisma: PrismaService,
    owner: UserRecord,
    token: string;
  const base = "/api/v2";
  const today = practiceDate(new Date());
  const yesterday = addPracticeDays(today, -1);
  const before = addPracticeDays(today, -2);
  const moment = (day: string) => `${day}T12:00:00.000Z`;
  const plan = (changes: Record<string, unknown> = {}) => ({
    effective_from: yesterday,
    frequency: "diaria",
    weekdays: [],
    timezone: "America/Recife",
    ...changes,
  });
  const create = (payload: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`${base}/acompanhamentos`)
      .auth(token, { type: "bearer" })
      .send({ titulo: "Ler", intent: "repetir", plan: plan(), ...payload })
      .expect(201);
  const update = (id: number, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`${base}/acompanhamentos/${id}`)
      .auth(token, { type: "bearer" })
      .send(payload);
  const record = (id: number, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`${base}/acompanhamentos/${id}/ocorrencias`)
      .auth(token, { type: "bearer" })
      .send(payload);
  const list = async () =>
    (
      await request(app.getHttpServer())
        .get(`${base}/acompanhamentos`)
        .auth(token, { type: "bearer" })
        .expect(200)
    ).body;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.pathname.includes("test")
    )
      throw new Error("Use banco local de teste explícito.");
    process.env.DATABASE_URL = url;
    process.env.BUNKERMODE_AUTH_SECRET = "practice-persistence-test-secret";
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    owner = await prisma.usuarios.create({
      data: {
        usuario: `practice-${suffix}`,
        email: `practice-${suffix}@example.test`,
        senha_hash: "unused",
      },
    });
    token = app
      .get(TokenService)
      .generate({ sub: owner.usuario_id, email: owner.email, version: 0 });
  });
  afterEach(async () => {
    await prisma.usuarios.delete({ where: { usuario_id: owner.usuario_id } });
  });
  afterAll(async () => {
    await app?.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.BUNKERMODE_AUTH_SECRET;
    else process.env.BUNKERMODE_AUTH_SECRET = previousSecret;
  });
  it("cria prática qualitativa independente sem gerar tarefas", async () => {
    const { body } = await create();
    expect(body).toMatchObject({
      objetivo_id: null,
      intent: "repetir",
      status: "ativo",
    });
    await record(body.id, { occurred_at: moment(yesterday) }).expect(201);
    expect(derivePractice((await list())[0]).closedFulfilled).toBe(1);
    expect(
      await prisma.missoes.count({
        where: { responsavel_id: owner.usuario_id },
      }),
    ).toBe(0);
  });
  it("preserva duas parciais, quantidade decimal e unidade no histórico", async () => {
    const { body } = await create({
      plan: plan({ target_amount: 30, unit: "páginas" }),
    });
    for (const amount of [20, 10])
      await record(body.id, {
        occurred_at: moment(yesterday),
        recorded_at: moment(yesterday),
        amount,
      }).expect(201);
    const item = (await list())[0];
    expect(item.ocorrencias).toHaveLength(2);
    expect(
      item.ocorrencias.map((entry: { amount: number }) => entry.amount).sort(),
    ).toEqual([10, 20]);
    expect(derivePractice(item).closedFulfilled).toBe(1);
    await record(body.id, { amount: 0.1234 }).expect(400);
  });
  it("dias fixos e meta semanal flexível persistem regras distintas", async () => {
    const fixed = (
      await create({
        plan: plan({ frequency: "dias_fixos", weekdays: [0, 2, 4] }),
      })
    ).body;
    const weekly = (
      await create({ plan: plan({ frequency: "semanal", times_per_week: 3 }) })
    ).body;
    expect(fixed.planos[0]).toMatchObject({
      weekdays: [0, 2, 4],
      times_per_week: null,
    });
    expect(weekly.planos[0]).toMatchObject({ weekdays: [], times_per_week: 3 });
  });
  it("troca de meta mantém plano e registros antigos e recusa reinterpretação do dia registrado", async () => {
    const { body } = await create({
      plan: plan({ target_amount: 10, unit: "páginas" }),
    });
    await record(body.id, {
      occurred_at: moment(yesterday),
      amount: 10,
    }).expect(201);
    await update(body.id, {
      plan: plan({ effective_from: today, target_amount: 30, unit: "páginas" }),
    }).expect(200);
    const item = (await list())[0];
    expect(item.planos).toHaveLength(2);
    expect(item.planos[0]).toMatchObject({
      effective_until: today,
      target_amount: 10,
    });
    expect(
      derivePractice(item).periods.find((period) => period.start === yesterday),
    ).toMatchObject({ target: 10, status: "cumprida" });
    await record(body.id, { amount: 20 }).expect(201);
    await update(body.id, {
      plan: plan({ effective_from: today, target_amount: 40 }),
    }).expect(400);
  });
  it("pausa e retomada preservam vigências e excluem oportunidades pausadas", async () => {
    const { body } = await create();
    await record(body.id, { occurred_at: moment(yesterday) }).expect(201);
    await update(body.id, { status: "pausado", effective_from: today }).expect(
      200,
    );
    await update(body.id, {
      status: "ativo",
      effective_from: addPracticeDays(today, 2),
    }).expect(200);
    const item = (await list())[0];
    expect(item.planos).toHaveLength(3);
    expect(item.planos[1]).toMatchObject({
      paused: true,
      effective_from: today,
      effective_until: addPracticeDays(today, 2),
    });
    expect(
      derivePractice(
        item,
        new Date(moment(addPracticeDays(today, 3))),
      ).periods.some((period) => period.start === today),
    ).toBe(false);
    expect(item.ocorrencias).toHaveLength(1);
  });
  it("vínculo opcional, desvínculo e exclusão de objetivo preservam identidade e histórico", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Ler mais" },
    });
    const { body } = await create();
    await record(body.id, {}).expect(201);
    await update(body.id, { objetivo_id: goal.id }).expect(200);
    await update(body.id, { objetivo_id: null }).expect(200);
    await update(body.id, { objetivo_id: goal.id }).expect(200);
    await prisma.objetivos.delete({ where: { id: goal.id } });
    expect((await list())[0]).toMatchObject({ id: body.id, objetivo_id: null });
    expect((await list())[0].ocorrencias).toHaveLength(1);
    const outsider = await prisma.usuarios.create({
      data: {
        usuario: `outsider-${body.id}`,
        email: `outsider-${body.id}@example.test`,
        senha_hash: "unused",
      },
    });
    try {
      const foreign = await prisma.objetivos.create({
        data: { usuario_id: outsider.usuario_id, titulo: "Outra conta" },
      });
      await update(body.id, { objetivo_id: foreign.id }).expect(404);
    } finally {
      await prisma.usuarios.delete({
        where: { usuario_id: outsider.usuario_id },
      });
    }
  });
  it("replay no dia seguinte preserva evento, quantidade, nota e idempotência", async () => {
    const { body } = await create({
      plan: plan({ target_amount: 30, unit: "páginas" }),
    });
    const operation = {
      operationId: crypto.randomUUID(),
      domain: "occurrence",
      action: "create",
      parentId: body.id,
      payload: {
        occurred_at: moment(yesterday),
        recorded_at: moment(yesterday),
        amount: 20,
        note: "Primeira parte",
      },
    };
    const send = () =>
      request(app.getHttpServer())
        .post(`${base}/offline/operations`)
        .auth(token, { type: "bearer" })
        .send(operation)
        .expect(201);
    const first = (await send()).body;
    expect((await send()).body).toEqual(first);
    const item = (await list())[0];
    expect(item.ocorrencias).toHaveLength(1);
    expect(item.ocorrencias[0]).toMatchObject({
      occurred_at: moment(yesterday),
      recorded_at: moment(yesterday),
      amount: 20,
      unit: "páginas",
      note: "Primeira parte",
    });
    expect(item.ocorrencias[0].created_at.slice(0, 10)).not.toBe(yesterday);
  });
  it("replay de mudança de plano usa a vigência capturada offline, sem reescrever registros anteriores", async () => {
    const { body } = await create({
      plan: plan({ effective_from: before, target_amount: 10 }),
    });
    await record(body.id, { occurred_at: moment(before), amount: 10 }).expect(
      201,
    );
    const operation = {
      operationId: crypto.randomUUID(),
      domain: "tracker",
      action: "update",
      target: body.id,
      baseUpdatedAt: body.updated_at,
      payload: {
        recorded_at: moment(yesterday),
        plan: plan({ target_amount: 30 }),
      },
    };
    await request(app.getHttpServer())
      .post(`${base}/offline/operations`)
      .auth(token, { type: "bearer" })
      .send(operation)
      .expect(201);
    const item = (await list())[0];
    expect(
      item.planos.map(
        (configuration: { target_amount: number }) =>
          configuration.target_amount,
      ),
    ).toEqual([10, 30]);
    expect(
      derivePractice(item).periods.find((period) => period.start === before),
    ).toMatchObject({ target: 10, status: "cumprida" });
  });
  it("redução e evitação exigem observação explícita de períodos encerrados", async () => {
    const reduce = (
      await create({
        intent: "reduzir",
        plan: plan({ target_amount: 2, unit: "copos" }),
      })
    ).body;
    await record(reduce.id, {
      occurred_at: moment(yesterday),
      amount: 1,
    }).expect(201);
    expect(derivePractice((await list())[0]).closedFulfilled).toBe(0);
    await record(reduce.id, {
      occurred_at: moment(yesterday),
      kind: "confirmacao",
    }).expect(201);
    expect(derivePractice((await list())[0]).closedFulfilled).toBe(1);
    const avoid = (
      await create({ intent: "evitar", plan: plan({ effective_from: before }) })
    ).body;
    await record(avoid.id, { kind: "confirmacao" }).expect(400);
    await record(avoid.id, {
      occurred_at: moment(yesterday),
      recorded_at: moment(yesterday),
      kind: "confirmacao",
    }).expect(400);
    await record(avoid.id, {
      occurred_at: moment(yesterday),
      kind: "confirmacao",
    }).expect(201);
    await record(avoid.id, {
      occurred_at: moment(yesterday),
      kind: "ocorrencia",
    }).expect(201);
    const item = (await list()).find(
      (practice: { id: number }) => practice.id === avoid.id,
    );
    expect(derivePractice(item)).toMatchObject({
      closedFulfilled: 0,
      bestStreak: 0,
      recordCount: 2,
    });
  });
  it("compatibilidade HTTP mantém acompanhamento antigo como registro livre", async () => {
    const legacy = await prisma.acompanhamentos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Observar" },
    });
    const old = await prisma.ocorrencias_acompanhamento.create({
      data: {
        acompanhamento_id: legacy.id,
        occurred_at: new Date(moment(before)),
      },
    });
    await record(legacy.id, {}).expect(201);
    const item = (await list())[0];
    expect(item).toMatchObject({ intent: "registro_livre", planos: [] });
    expect(
      item.ocorrencias.find((entry: { id: number }) => entry.id === old.id),
    ).toMatchObject({
      occurred_at: moment(before),
      kind: "ocorrencia",
      amount: null,
    });
    expect(derivePractice(item).closedExpected).toBe(0);
    await update(legacy.id, { intent: "repetir", plan: plan() }).expect(400);
  });
  it("registro livre aceita quantidade e duração sem inventar meta ou misturar unidades", async () => {
    const { body } = await create({
      intent: "registro_livre",
      plan: undefined,
    });
    const quantity = await record(body.id, {
      amount: 1.5,
      unit: "copos",
      occurred_at: moment(yesterday),
    }).expect(201);
    expect(quantity.body.amount).toBe(1.5);
    expect(quantity.body.unit).toBe("copos");
    await record(body.id, {
      amount: 20,
      unit: "minutos",
      occurred_at: moment(yesterday),
    }).expect(201);
    await record(body.id, { unit: "minutos" }).expect(400);
    await record(body.id, { amount: 1, unit: "x".repeat(41) }).expect(400);
    const facts = derivePractice((await list())[0]);
    expect(facts).toMatchObject({
      closedExpected: 0,
      closedFulfilled: 0,
      recordCount: 2,
    });
    expect(facts.quantityTotals).toEqual(
      expect.arrayContaining([
        { amount: 1.5, unit: "copos" },
        { amount: 20, unit: "minutos" },
      ]),
    );
  });
  it("migration aditiva mantém IDs, datas e semântica dos registros pré-existentes", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA practice_legacy_test");
      await client.query("SET LOCAL search_path TO practice_legacy_test");
      await client.query(
        "CREATE TABLE acompanhamentos (id SERIAL PRIMARY KEY, titulo VARCHAR(200) NOT NULL); CREATE TABLE ocorrencias_acompanhamento (id SERIAL PRIMARY KEY, acompanhamento_id INTEGER NOT NULL REFERENCES acompanhamentos(id), occurred_at TIMESTAMP(6) NOT NULL, created_at TIMESTAMP(6) NOT NULL)",
      );
      await client.query(
        "INSERT INTO acompanhamentos(id,titulo) VALUES(42,'Observar'); INSERT INTO ocorrencias_acompanhamento(id,acompanhamento_id,occurred_at,created_at) VALUES(7,42,'2026-09-01T18:00:00','2026-09-02T18:00:00')",
      );
      await client.query(
        await readFile(
          join(
            __dirname,
            "../prisma/migrations/20261005120000_practice_foundation/migration.sql",
          ),
          "utf8",
        ),
      );
      expect(
        (await client.query("SELECT id,intent,status FROM acompanhamentos"))
          .rows,
      ).toEqual([{ id: 42, intent: "registro_livre", status: "ativo" }]);
      const rows = (
        await client.query(
          "SELECT id,acompanhamento_id,occurred_at::text,created_at::text,kind,amount,recorded_at FROM ocorrencias_acompanhamento",
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 7,
        acompanhamento_id: 42,
        kind: "ocorrencia",
        amount: null,
        recorded_at: null,
      });
      expect(rows[0].occurred_at).toBe("2026-09-01 18:00:00");
      expect(rows[0].created_at).toBe("2026-09-02 18:00:00");
      expect(
        (
          await client.query(
            "SELECT COUNT(*)::int AS count FROM planos_pratica",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
  it("registro capturado sob outro plano ou unidade vira conflito e não é reinterpretado", async () => {
    const { body } = await create({
      plan: plan({ target_amount: 30, unit: "páginas" }),
    });
    await record(body.id, {
      occurred_at: moment(yesterday),
      amount: 20,
      plan_effective_from: yesterday,
      unit: "minutos",
    }).expect(409);
    await record(body.id, {
      occurred_at: moment(yesterday),
      amount: 20,
      plan_effective_from: before,
      unit: "páginas",
    }).expect(409);
    expect((await list())[0].ocorrencias).toHaveLength(0);
    await record(body.id, {
      occurred_at: moment(yesterday),
      amount: 20,
      plan_effective_from: yesterday,
      unit: "páginas",
    }).expect(201);
    const fresh = (
      await create({
        plan: plan({
          effective_from: today,
          target_amount: 30,
          unit: "páginas",
        }),
      })
    ).body;
    const capturedPlan = practicePlanSignature(fresh.planos[0]);
    await update(fresh.id, {
      plan: plan({ effective_from: today, target_amount: 40, unit: "páginas" }),
    }).expect(200);
    await record(fresh.id, { amount: 20, plan_signature: capturedPlan }).expect(
      409,
    );
  });
});
