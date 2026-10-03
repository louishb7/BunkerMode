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

  it("persiste Entrada/Saída e recalcula saldo, resumo, histórico e gráfico ao mudar o tipo", async () => {
    const income = await request(app.getHttpServer())
      .post(`${base}/financas/lancamentos`)
      .set(auth())
      .send({
        titulo: "Trabalho",
        tipo: "receita",
        valor_centavos: 1250,
        data: "2026-09-01",
      })
      .expect(201);
    const expense = await request(app.getHttpServer())
      .post(`${base}/financas/lancamentos`)
      .set(auth())
      .send({
        titulo: "Compra",
        tipo: "despesa",
        valor_centavos: 100,
        data: "2026-09-02",
      })
      .expect(201);
    expect(
      await prisma.lancamentos_financeiros.findMany({
        where: { usuario_id: owner.usuario_id },
        orderBy: { id: "asc" },
      }),
    ).toMatchObject([
      { tipo: "receita", valor_centavos: 1250 },
      { tipo: "despesa", valor_centavos: 100 },
    ]);
    let overview = (
      await request(app.getHttpServer())
        .get(`${base}/financas?mes=2026-09`)
        .set(auth())
        .expect(200)
    ).body;
    expect(overview).toMatchObject({
      saldo_centavos: 1150,
      resultado_centavos: 1150,
      receitas_centavos: 1250,
      despesas_centavos: 100,
    });
    expect(overview.serie_diaria.at(-1)).toMatchObject({
      resultado_centavos: 1150,
      receitas_centavos: 1250,
      despesas_centavos: 100,
    });
    expect(overview.lancamentos.map((item: { id: number }) => item.id)).toEqual(
      [expense.body.id, income.body.id],
    );
    expect(overview.lancamentos[0]).not.toHaveProperty("categoria");
    await request(app.getHttpServer())
      .patch(`${base}/financas/lancamentos/${expense.body.id}`)
      .set(auth())
      .send({ tipo: "receita" })
      .expect(200);
    overview = await service.overview(owner, "2026-09");
    expect(overview).toMatchObject({
      saldo_centavos: 1350,
      resultado_centavos: 1350,
      receitas_centavos: 1350,
      despesas_centavos: 0,
    });
    expect(overview.serie_diaria.at(-1)).toMatchObject({
      resultado_centavos: 1350,
      receitas_centavos: 1350,
      despesas_centavos: 0,
    });
    await request(app.getHttpServer())
      .delete(`${base}/financas/lancamentos/${income.body.id}`)
      .set(auth())
      .expect(204);
    expect(await service.registeredBalance(owner)).toBe(100);
  });

  it("remove reservas e categorias do schema e encerra as rotas da feature", async () => {
    const tables = await prisma.$queryRaw<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reservas_financeiras'`;
    const columns = await prisma.$queryRaw<
      { column_name: string }[]
    >`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lancamentos_financeiros' AND column_name = 'categoria'`;
    expect(tables).toEqual([]);
    expect(columns).toEqual([]);
    await request(app.getHttpServer())
      .get(`${base}/financas/reservas`)
      .set(auth())
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/financas/reservas`)
      .set(auth())
      .send({})
      .expect(404);
  });

  it("401 protege todas as novas leituras e escritas", async () => {
    await request(app.getHttpServer()).get(`${base}/financas`).expect(401);
    await request(app.getHttpServer()).get(`${base}/orientacao`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/financas/lancamentos`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${base}/financas/lancamentos/1`)
      .send({})
      .expect(401);
  });
  it("cria, lista por mês, edita e exclui valores exatos, distinguindo saldo, fluxo", async () => {
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
    let overview = await service.overview(owner, "2026-02");
    expect(overview).toMatchObject({
      saldo_centavos: 101000,
      resultado_centavos: 1000,
      receitas_centavos: 1010,
      despesas_centavos: 10,
    });
    expect(overview.serie_diaria.at(-1)?.resultado_centavos).toBe(1000);
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
      .delete(`${base}/financas/lancamentos/${expense.id}`)
      .set(auth())
      .expect(204);
    overview = await service.overview(owner, "2026-01");
    expect(overview).toMatchObject({
      saldo_centavos: 100020,
      resultado_centavos: 0,
      receitas_centavos: 0,
      despesas_centavos: 0,
    });
    expect(overview.lancamentos.map((x) => x.id)).toEqual([initial.body.id]);
  });
  it("aceita movimento simples e retorna o histórico mensal completo sem truncar resumo ou série diária", async () => {
    const created = await request(app.getHttpServer())
      .post(`${base}/financas/lancamentos`)
      .set(auth())
      .send({ titulo: "Entrada rápida", tipo: "receita", valor_centavos: 123 })
      .expect(201);
    expect(created.body).toMatchObject({
      valor_centavos: 123,
    });
    const month = created.body.data.slice(0, 7);
    await prisma.lancamentos_financeiros.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        usuario_id: owner.usuario_id,
        titulo: `Saída ${index}`,
        tipo: "despesa",
        valor_centavos: 100,
        data: new Date(`${month}-01T00:00:00Z`),
      })),
    });
    const overview = await service.overview(owner, month);
    expect(overview.lancamentos).toHaveLength(26);
    expect(overview.receitas_centavos).toBe(123);
    expect(overview.despesas_centavos).toBe(2500);
    expect(overview.resultado_centavos).toBe(-2377);
    expect(overview.serie_diaria.at(-1)?.resultado_centavos).toBe(-2377);
    expect(overview).not.toHaveProperty("reservas");
  });
  it("nega enumeração, edição, exclusão e relações entre usuários", async () => {
    const row = await service.createEntry(owner, entry);
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção privada" },
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
    for (const path of [`lancamentos/${row.id}`]) {
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
    const foreignGoal = await prisma.objetivos.create({
      data: { usuario_id: other.usuario_id, titulo: "Alheio" },
    });
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
  });
  it("registra entradas e saídas e sinaliza apenas saldo negativo na Home", async () => {
    await service.createEntry(owner, { ...entry, valor_centavos: 100 });
    await service.createEntry(owner, {
      ...entry,
      tipo: "despesa",
      valor_centavos: 50,
    });
    expect(await service.registeredBalance(owner)).toBe(50);
    const home = await request(app.getHttpServer())
      .get(`${base}/orientacao`)
      .set(auth())
      .expect(200);
    expect(home.body.financeiro).toBeNull();
    await service.createEntry(owner, {
      ...entry,
      tipo: "despesa",
      valor_centavos: 100,
    });
    const negative = await request(app.getHttpServer())
      .get(`${base}/orientacao`)
      .set(auth())
      .expect(200);
    expect(negative.body.financeiro).toEqual({ saldo_centavos: -50 });
  });
  it("desvincula e exclui objetivo preservando acompanhamentos e ocorrências", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção" },
    });
    await service.createEntry(owner, entry);
    const trackers = app.get(TrackersService);
    const tracker = await trackers.create(owner, {
      titulo: "Condição",
      objetivo_id: goal.id,
    });
    await trackers.recordOccurrence(owner, tracker.id);
    await trackers.update(owner, tracker.id, { objetivo_id: null });
    expect((await trackers.list(owner))[0]).toMatchObject({
      objetivo_id: null,
      ocorrencias: [expect.any(Object)],
    });
    await trackers.update(owner, tracker.id, { objetivo_id: goal.id });
    await request(app.getHttpServer())
      .delete(`${base}/objetivos/${goal.id}`)
      .set(auth())
      .expect(204);
    expect((await trackers.list(owner))[0]).toMatchObject({
      objetivo_id: null,
      ocorrencias: [expect.any(Object)],
    });
  });
  it("preferência remove sinais da Home sem apagar dados e mantém módulos independentes", async () => {
    const goal = await prisma.objetivos.create({
      data: { usuario_id: owner.usuario_id, titulo: "Direção" },
    });
    await service.createEntry(owner, entry);
    let home = (
      await request(app.getHttpServer())
        .get(`${base}/orientacao`)
        .set(auth())
        .expect(200)
    ).body;
    expect(home.direcoes[0].reserves).toBeUndefined();
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
    expect(home.direcoes[0].reserves).toBeUndefined();
    expect(home.tarefas).toEqual([]);
    expect(home.financeiro).toBeNull();
    expect(JSON.stringify(home)).not.toContain("42000");
    expect(JSON.stringify(home)).not.toContain("Reserva privada");
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
