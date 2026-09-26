import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { TokenService } from "../src/auth/token.service";
import { UserRecord } from "../src/auth/auth.types";
import { FinancesService } from "../src/finances/finances.service";
import { TrackersService } from "../src/goals/trackers.service";

const url = process.env.TEST_DATABASE_URL;
const dbSuite = url ? describe : describe.skip;
const originalUrl = process.env.DATABASE_URL;
const originalSecret = process.env.BUNKERMODE_AUTH_SECRET;

dbSuite("Finanças, vínculos e orientação no PostgreSQL real", () => {
  let app: INestApplication, prisma: PrismaService, service: FinancesService;
  let owner: UserRecord, other: UserRecord, token: string, otherToken: string;
  const base = "/api/v2";
  const entry = {
    titulo: "Saldo inicial",
    tipo: "ajuste_entrada",
    categoria: "Ajuste",
    valor_centavos: 100000,
    data: "2026-01-01",
  };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.pathname.includes("test")
    )
      throw new Error("Use banco local de teste explícito.");
    process.env.DATABASE_URL = url;
    process.env.BUNKERMODE_AUTH_SECRET = "finance-test-isolated-secret";
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(FinancesService);
  });
  beforeEach(async () => {
    const seed = `${Date.now()}-${Math.random()}`;
    owner = await prisma.usuarios.create({
      data: {
        usuario: `finance-${seed}`,
        email: `finance-${seed}@example.test`,
        senha_hash: "unused",
        enabled_modules: ["tasks", "objectives", "finances"],
      },
    });
    other = await prisma.usuarios.create({
      data: {
        usuario: `other-${seed}`,
        email: `other-${seed}@example.test`,
        senha_hash: "unused",
      },
    });
    const tokens = app.get(TokenService);
    token = tokens.generate({
      sub: owner.usuario_id,
      email: owner.email,
      version: 0,
    });
    otherToken = tokens.generate({
      sub: other.usuario_id,
      email: other.email,
      version: 0,
    });
  });
  afterEach(async () => {
    await prisma.usuarios.deleteMany({
      where: { usuario_id: { in: [owner.usuario_id, other.usuario_id] } },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.BUNKERMODE_AUTH_SECRET;
    else process.env.BUNKERMODE_AUTH_SECRET = originalSecret;
  });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it("401 protege todas as novas leituras e escritas", async () => {
    await request(app.getHttpServer()).get(`${base}/financas`).expect(401);
    await request(app.getHttpServer()).get(`${base}/orientacao`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${base}/financas/lancamentos/1`)
      .send({})
      .expect(401);
  });
  it("cria, lista por mês, edita e exclui valores exatos, distinguindo saldo, fluxo e reserva", async () => {
    const initial = await request(app.getHttpServer())
      .post(`${base}/financas/lancamentos`)
      .set(auth())
      .send(entry)
      .expect(201);
    const income = await service.createEntry(owner, {
      ...entry,
      tipo: "receita",
      valor_centavos: 1010,
      data: "2026-02-01",
    });
    const expense = await service.createEntry(owner, {
      ...entry,
      tipo: "despesa",
      valor_centavos: 10,
      data: "2026-02-01",
    });
    const reserve = await service.saveReserve(owner, {
      titulo: "Emergência",
      valor_centavos: 42000,
      alvo_centavos: 100000,
    });
    let overview = await service.overview(owner, "2026-02");
    expect(overview).toMatchObject({
      saldo_centavos: 101000,
      reservado_centavos: 42000,
      livre_centavos: 59000,
      receitas_centavos: 1010,
      despesas_centavos: 10,
    });
    expect(overview.lancamentos.map((x) => x.id)).toEqual([
      expense.id,
      income.id,
    ]);
    await request(app.getHttpServer())
      .patch(`${base}/financas/lancamentos/${income.id}`)
      .set(auth())
      .send({ valor_centavos: 20 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${base}/financas/reservas/${reserve.id}`)
      .set(auth())
      .send({ titulo: "Reserva atualizada", alvo_centavos: null })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${base}/financas/lancamentos/${expense.id}`)
      .set(auth())
      .expect(204);
    await request(app.getHttpServer())
      .delete(`${base}/financas/reservas/${reserve.id}`)
      .set(auth())
      .expect(204);
    overview = await service.overview(owner, "2026-01");
    expect(overview).toMatchObject({
      saldo_centavos: 100020,
      reservado_centavos: 0,
      receitas_centavos: 0,
      despesas_centavos: 0,
    });
    expect(overview.lancamentos.map((x) => x.id)).toEqual([initial.body.id]);
  });
  it("nega enumeração, edição, exclusão e relações entre usuários", async () => {
    const row = await service.createEntry(owner, entry);
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção privada" },
    });
    const reserve = await service.saveReserve(owner, {
      titulo: "Segredo financeiro",
      valor_centavos: 500,
      objetivo_id: goal.id,
    });
    const foreignHeaders = { Authorization: `Bearer ${otherToken}` };
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/financas?mes=2026-01`)
          .set(foreignHeaders)
          .expect(200)
      ).body.lancamentos,
    ).toEqual([]);
    for (const path of [`lancamentos/${row.id}`, `reservas/${reserve.id}`]) {
      await request(app.getHttpServer())
        .patch(`${base}/financas/${path}`)
        .set(foreignHeaders)
        .send({ titulo: "Invadido" })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${base}/financas/${path}`)
        .set(foreignHeaders)
        .expect(404);
    }
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .set(foreignHeaders)
      .send({ titulo: "Inválida", objetivo_id: goal.id })
      .expect(404);
    const foreignGoal = await prisma.objetivos.create({
      data: { usuario_id: other.usuario_id, titulo: "Alheio" },
    });
    await request(app.getHttpServer())
      .patch(`${base}/financas/reservas/${reserve.id}`)
      .set(auth())
      .send({ objetivo_id: foreignGoal.id })
      .expect(404);
    const tracker = await app
      .get(TrackersService)
      .create(owner, { objetivo_id: goal.id, titulo: "Ocorrência" });
    await expect(
      app
        .get(TrackersService)
        .update(owner, tracker.id, { objetivo_id: foreignGoal.id }),
    ).rejects.toMatchObject({ status: 404 });
    const home = await request(app.getHttpServer())
      .get(`${base}/orientacao`)
      .set(foreignHeaders)
      .expect(200);
    expect(JSON.stringify(home.body)).not.toContain("Segredo financeiro");
  });
  it("rejeita moedas fracionárias, overflow, datas futuras e relações inválidas", async () => {
    for (const value of [0, -1, 1.01, "100", 2147483648, null])
      await request(app.getHttpServer())
        .post(`${base}/financas/lancamentos`)
        .set(auth())
        .send({ ...entry, valor_centavos: value })
        .expect(400);
    for (const patch of [
      { data: "2099-01-01" },
      { data: "2026-02-30" },
      { tipo: "transferencia" },
      { categoria: "inventada" },
      { titulo: "" },
    ])
      await request(app.getHttpServer())
        .post(`${base}/financas/lancamentos`)
        .set(auth())
        .send({ ...entry, ...patch })
        .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/financas?mes=2026-13`)
      .set(auth())
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .set(auth())
      .send({ titulo: "Reserva", valor_centavos: -1 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .set(auth())
      .send({ titulo: "Reserva", alvo_centavos: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .set(auth())
      .send({ titulo: "Reserva", objetivo_id: 2147483647 })
      .expect(404);
  });
  it("impede sobrealocação concorrente, mas registra despesa real e mostra déficit", async () => {
    await service.createEntry(owner, { ...entry, valor_centavos: 100 });
    const results = await Promise.allSettled([
      service.saveReserve(owner, { titulo: "A", valor_centavos: 80 }),
      service.saveReserve(owner, { titulo: "B", valor_centavos: 80 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await service.createEntry(owner, {
      ...entry,
      tipo: "despesa",
      valor_centavos: 50,
    });
    expect(await service.totals(owner)).toMatchObject({
      saldo_centavos: 50,
      reservado_centavos: 80,
      livre_centavos: -30,
    });
    const home = await request(app.getHttpServer())
      .get(`${base}/orientacao`)
      .set(auth())
      .expect(200);
    expect(home.body.financeiro).toEqual({ livre_centavos: -30 });
  });
  it("desvincula e exclui objetivo preservando reservas, acompanhamentos e ocorrências", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção" },
    });
    await service.createEntry(owner, entry);
    const reserve = await service.saveReserve(owner, {
      titulo: "Recursos",
      valor_centavos: 42000,
      objetivo_id: goal.id,
    });
    const trackers = app.get(TrackersService);
    const tracker = await trackers.create(owner, {
      titulo: "Condição",
      objetivo_id: goal.id,
    });
    await trackers.recordOccurrence(owner, tracker.id);
    await service.saveReserve(owner, { objetivo_id: null }, reserve.id);
    await trackers.update(owner, tracker.id, { objetivo_id: null });
    expect((await trackers.list(owner))[0]).toMatchObject({
      objetivo_id: null,
      ocorrencias: [expect.any(Object)],
    });
    expect((await service.overview(owner)).reservas[0]).toMatchObject({
      objetivo_id: null,
      valor_centavos: 42000,
    });
    await service.saveReserve(owner, { objetivo_id: goal.id }, reserve.id);
    await trackers.update(owner, tracker.id, { objetivo_id: goal.id });
    await request(app.getHttpServer())
      .delete(`${base}/objetivos/${goal.id}`)
      .set(auth())
      .expect(204);
    expect((await trackers.list(owner))[0]).toMatchObject({
      objetivo_id: null,
      ocorrencias: [expect.any(Object)],
    });
    expect((await service.overview(owner)).reservas[0]).toMatchObject({
      objetivo_id: null,
      valor_centavos: 42000,
    });
  });
  it("preferência remove sinais da Home sem apagar dados e mantém módulos independentes", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção" },
    });
    await service.createEntry(owner, entry);
    await service.saveReserve(owner, {
      titulo: "Reserva privada",
      valor_centavos: 42000,
      objetivo_id: goal.id,
    });
    let home = (
      await request(app.getHttpServer())
        .get(`${base}/orientacao`)
        .set(auth())
        .expect(200)
    ).body;
    expect(home.direcoes[0].reserves[0].valor_centavos).toBe(42000);
    expect(home.financeiro).toBeNull();
    await request(app.getHttpServer())
      .patch(`${base}/usuarios/me/modulos`)
      .set(auth())
      .send({ enabled_modules: ["objectives"] })
      .expect(200);
    home = (
      await request(app.getHttpServer())
        .get(`${base}/orientacao`)
        .set(auth())
        .expect(200)
    ).body;
    expect(home.direcoes[0].reserves).toEqual([]);
    expect(home.tarefas).toEqual([]);
    expect(home.financeiro).toBeNull();
    expect(JSON.stringify(home)).not.toContain("42000");
    expect(JSON.stringify(home)).not.toContain("Reserva privada");
    // Preferência não substitui autenticação/ownership: acesso próprio direto permanece.
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/financas`)
          .set(auth())
          .expect(200)
      ).body.reservas,
    ).toHaveLength(1);
    await request(app.getHttpServer())
      .patch(`${base}/objetivos/${goal.id}/status`)
      .set(auth())
      .send({ status: "pausado" })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/orientacao`)
          .set(auth())
          .expect(200)
      ).body.direcoes,
    ).toEqual([]);
    await request(app.getHttpServer())
      .patch(`${base}/objetivos/${goal.id}/status`)
      .set(auth())
      .send({ status: "concluido" })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/orientacao`)
          .set(auth())
          .expect(200)
      ).body.direcoes,
    ).toEqual([]);
    await request(app.getHttpServer())
      .patch(`${base}/usuarios/me/modulos`)
      .set(auth())
      .send({ enabled_modules: [] })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/orientacao`)
          .set(auth())
          .expect(200)
      ).body,
    ).toMatchObject({ tarefas: [], direcoes: [], financeiro: null });
  });
  it("vincula e desvincula uma série inteira sem apagar status ou histórico", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Ler livro" },
    });
    const foreign = await prisma.objetivos.create({
      data: { usuario_id: other.usuario_id, titulo: "Alheio" },
    });
    const series = await prisma.series_recorrencia.create({
      data: {
        responsavel_id: owner.usuario_id,
        titulo: "Ler",
        recurrence_weekdays: [0, 1, 2, 3, 4, 5, 6],
        start_date: new Date("2026-09-01"),
        termination_policy: "sem_termino",
      },
    });
    const task = await prisma.missoes.create({
      data: {
        titulo: "Ler",
        criada_por_id: owner.usuario_id,
        responsavel_id: owner.usuario_id,
        recurrence_series_id: series.recurrence_series_id,
        status: "CONCLUIDA",
        completed_at: new Date("2026-09-01T12:00:00Z"),
        prazo: new Date("2026-09-01"),
      },
    });
    const second = await prisma.missoes.create({
      data: {
        titulo: "Ler",
        criada_por_id: owner.usuario_id,
        responsavel_id: owner.usuario_id,
        recurrence_series_id: series.recurrence_series_id,
        prazo: new Date("2026-09-02"),
      },
    });
    await prisma.auditoria_eventos.create({
      data: {
        missao_id: task.missao_id,
        usuario_id: owner.usuario_id,
        acao: "concluida",
        detalhes: "Registro preservado",
      },
    });
    await request(app.getHttpServer())
      .post(`${base}/tarefas/${task.missao_id}/vincular-objetivo`)
      .set(auth())
      .send({ objetivo_id: foreign.id })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/tarefas/${task.missao_id}/vincular-objetivo`)
      .set(auth())
      .send({ objetivo_id: goal.id })
      .expect(201);
    expect(
      await prisma.missoes.count({
        where: { objetivo_id: goal.id, responsavel_id: owner.usuario_id },
      }),
    ).toBe(2);
    await request(app.getHttpServer())
      .post(`${base}/tarefas/${second.missao_id}/desvincular-objetivo`)
      .set(auth())
      .expect(201);
    expect(
      await prisma.missoes.findUnique({ where: { missao_id: task.missao_id } }),
    ).toMatchObject({ objetivo_id: null, status: "CONCLUIDA" });
    expect(
      await prisma.series_recorrencia.findUnique({
        where: { recurrence_series_id: series.recurrence_series_id },
      }),
    ).toMatchObject({ objetivo_id: null });
    expect(
      await prisma.auditoria_eventos.count({
        where: { missao_id: task.missao_id },
      }),
    ).toBe(1);
  });
});
