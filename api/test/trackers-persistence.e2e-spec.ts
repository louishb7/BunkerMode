import { PrismaService } from "../src/prisma/prisma.service";
import { TrackersService } from "../src/goals/trackers.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const originalDatabaseUrl = process.env.DATABASE_URL;

describeWithDatabase("Acompanhamentos no PostgreSQL", () => {
  let prisma: PrismaService;
  let service: TrackersService;
  let userId: number;
  let goalId: number;

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = new PrismaService();
    service = new TrackersService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const user = await prisma.usuarios.create({
      data: { usuario: `tracker-${suffix}`, email: `tracker-${suffix}@bunker.local`, senha_hash: "hash" },
    });
    userId = user.usuario_id;
    const goal = await prisma.objetivos.create({ data: { usuario_id: userId, titulo: "Parar de fumar" } });
    goalId = goal.id;
  });

  afterEach(async () => {
    await prisma.usuarios.delete({ where: { usuario_id: userId } });
  });

  it("persiste somente eventos reais e preserva tarefas ao excluir acompanhamento", async () => {
    const owner = { usuario_id: userId } as never;
    const task = await prisma.missoes.create({
      data: { titulo: "Outra tarefa", criada_por_id: userId, responsavel_id: userId, objetivo_id: goalId },
    });
    const tracker = await service.create(owner, { objetivo_id: goalId, titulo: "Não fumar" });
    expect(await prisma.ocorrencias_acompanhamento.count({ where: { acompanhamento_id: tracker.id } })).toBe(0);
    const first = await service.recordOccurrence(owner, tracker.id);
    const second = await service.recordOccurrence(owner, tracker.id);
    expect(first.id).not.toBe(second.id);
    expect((await service.list(owner))[0].ocorrencias).toHaveLength(2);
    await service.deleteOccurrence(owner, tracker.id, first.id);
    expect(await prisma.ocorrencias_acompanhamento.count({ where: { acompanhamento_id: tracker.id } })).toBe(1);
    await service.delete(owner, tracker.id);
    expect(await prisma.ocorrencias_acompanhamento.count({ where: { acompanhamento_id: tracker.id } })).toBe(0);
    expect(await prisma.missoes.findUnique({ where: { missao_id: task.missao_id } })).toMatchObject({ objetivo_id: goalId });
  });

  it("nega acesso a acompanhamento de outro usuário", async () => {
    const outsider = { usuario_id: userId + 100_000 } as never;
    await expect(service.create(outsider, { objetivo_id: goalId, titulo: "Não fumar" })).rejects.toMatchObject({ status: 404 });
    const tracker = await service.create({ usuario_id: userId } as never, { objetivo_id: goalId, titulo: "Não fumar" });
    await expect(service.recordOccurrence(outsider, tracker.id)).rejects.toMatchObject({ status: 404 });
  });
});
