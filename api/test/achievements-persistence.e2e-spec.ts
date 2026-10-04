import { PrismaService } from "../src/prisma/prisma.service";
import { GoalsService } from "../src/goals/goals.service";
import { UserRecord } from "../src/auth/auth.types";

const url = process.env.TEST_DATABASE_URL;
const original = process.env.DATABASE_URL;
(url ? describe : describe.skip)("Memórias de conquista no PostgreSQL", () => {
  let prisma: PrismaService;
  let service: GoalsService;
  let user: UserRecord;
  let goalId: number;
  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    service = new GoalsService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });
  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const row = await prisma.usuarios.create({
      data: {
        usuario: `crown-${suffix}`,
        email: `${suffix}@crown.test`,
        senha_hash: "hash",
      },
    });
    user = row as UserRecord;
    goalId = (
      await service.create(user, {
        titulo: "Primeira vaga",
        descricao: "Construir consistência",
      })
    ).id;
  });
  afterEach(async () => {
    await prisma.usuarios.delete({ where: { usuario_id: user.usuario_id } });
  });

  it("captura fatos, nota e data uma única vez e preserva a memória depois de edições e exclusões", async () => {
    const series = await prisma.series_recorrencia.create({
      data: {
        responsavel_id: user.usuario_id,
        objetivo_id: goalId,
        titulo: "Estudar",
        recurrence_weekdays: [0, 2, 4],
        start_date: new Date("2026-01-01"),
      },
    });
    await prisma.missoes.createMany({
      data: [
        {
          titulo: "Estudar",
          responsavel_id: user.usuario_id,
          criada_por_id: user.usuario_id,
          objetivo_id: goalId,
          recurrence_series_id: series.recurrence_series_id,
          prazo: new Date("2026-01-01"),
          status: "CONCLUIDA",
          completed_at: new Date("2026-01-01T12:00:00Z"),
        },
        {
          titulo: "Enviar currículo",
          responsavel_id: user.usuario_id,
          criada_por_id: user.usuario_id,
          objetivo_id: goalId,
        },
      ],
    });
    const tracker = await prisma.acompanhamentos.create({
      data: {
        usuario_id: user.usuario_id,
        objetivo_id: goalId,
        titulo: "Distrações",
        ocorrencias: {
          create: Array.from({ length: 7 }, (_, i) => ({
            occurred_at: new Date(`2026-01-0${i + 1}T12:00:00Z`),
          })),
        },
      },
    });
    const achievement = await service.conquer(user, goalId, {
      nota: " Eu consegui. ",
    });
    expect(achievement).toMatchObject({
      nota: "Eu consegui.",
      conquistado_em: expect.any(Date),
    });
    const snapshot = achievement.snapshot as Record<string, any>;
    expect(snapshot).toMatchObject({
      titulo: "Primeira vaga",
      proposito: "Construir consistência",
      version: 1,
    });
    expect(snapshot.nos).toHaveLength(3);
    expect(
      snapshot.nos.find((node: any) => node.tipo === "rotina"),
    ).toMatchObject({ realizadas: 1, frequencia: [0, 2, 4] });
    expect(
      snapshot.nos.find((node: any) => node.tipo === "acompanhamento"),
    ).toMatchObject({
      ocorrencias_total: 7,
      ultima_ocorrencia: "2026-01-07T12:00:00.000Z",
    });
    expect(snapshot).not.toHaveProperty("finances");
    expect((await service.list(user))[0]).toMatchObject({
      status: "concluido",
      concluded_at: achievement.conquistado_em!.toISOString(),
    });
    await service.update(user, goalId, { titulo: "Título posterior" });
    await prisma.acompanhamentos.delete({ where: { id: tracker.id } });
    await prisma.missoes.deleteMany({ where: { objetivo_id: goalId } });
    await prisma.series_recorrencia.update({
      where: { recurrence_series_id: series.recurrence_series_id },
      data: { titulo: "Outra rotina" },
    });
    expect(
      (await service.conquer(user, goalId, { nota: "Outra nota" })).snapshot,
    ).toEqual(snapshot);
    expect((await service.listAchievements(user))[0].nota).toBe("Eu consegui.");
    await service.delete(user, goalId);
    expect((await service.listAchievements(user))[0]).toMatchObject({
      objetivo_id: null,
      snapshot,
    });
  });

  it("duas confirmações concorrentes produzem uma única coroa", async () => {
    const [first, second] = await Promise.all([
      service.conquer(user, goalId, {}),
      service.conquer(user, goalId, {}),
    ]);
    expect(first.id).toBe(second.id);
    expect(await service.listAchievements(user)).toHaveLength(1);
    await expect(
      service.updateStatus(user, goalId, "ativo"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("conclusão pelo contrato existente também captura uma memória e não exige nota", async () => {
    await service.updateStatus(user, goalId, "concluido");
    expect((await service.listAchievements(user))[0]).toMatchObject({
      nota: null,
      snapshot: { nos: [] },
    });
  });

  it("valida ownership, nota e não concede coroa por completar tarefas", async () => {
    const outsider = { ...user, usuario_id: user.usuario_id + 100000 };
    await expect(service.conquer(outsider, goalId, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.conquer(user, goalId, { nota: "x".repeat(2001) }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.conquer(user, goalId, { nota: 42 }),
    ).rejects.toMatchObject({ status: 400 });
    await prisma.missoes.create({
      data: {
        titulo: "Feito",
        status: "CONCLUIDA",
        completed_at: new Date(),
        responsavel_id: user.usuario_id,
        criada_por_id: user.usuario_id,
        objetivo_id: goalId,
      },
    });
    expect(await service.listAchievements(user)).toEqual([]);
    expect((await service.list(user))[0].status).toBe("ativo");
    await service.conquer(user, goalId, {});
    expect(await service.listAchievements(outsider)).toEqual([]);
  });
});
