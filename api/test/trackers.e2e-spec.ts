import { TrackersService } from "../src/goals/trackers.service";
import { PrismaService } from "../src/prisma/prisma.service";

const user = { usuario_id: 7 } as never;

function setup() {
  const prisma = {
    objetivos: { findFirst: jest.fn() },
    acompanhamentos: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ocorrencias_acompanhamento: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    missoes: { create: jest.fn(), delete: jest.fn() },
  };
  return {
    prisma,
    service: new TrackersService(prisma as unknown as PrismaService),
  };
}

describe("Acompanhamentos", () => {
  it("lista todos os acompanhamentos em uma consulta filtrada pelo dono", async () => {
    const { prisma, service } = setup();
    await service.list(user);
    expect(prisma.acompanhamentos.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.acompanhamentos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuario_id: 7 },
        include: {
          ocorrencias: {
            orderBy: [{ occurred_at: "desc" }, { id: "desc" }],
            take: 5,
          },
        },
      }),
    );
  });

  it("cria apenas dentro de um objetivo do usuário", async () => {
    const { prisma, service } = setup();
    prisma.objetivos.findFirst.mockResolvedValue({ id: 3 });
    prisma.acompanhamentos.create.mockResolvedValue({
      id: 11,
      objetivo_id: 3,
      ocorrencias: [],
    });
    await service.create(user, {
      objetivo_id: 3,
      titulo: " Não fumar ",
      descricao: "",
    });
    expect(prisma.objetivos.findFirst).toHaveBeenCalledWith({
      where: { id: 3, usuario_id: 7 },
      select: { id: true },
    });
    expect(prisma.acompanhamentos.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          usuario_id: 7,
          objetivo_id: 3,
          titulo: "Não fumar",
          descricao: null,
        },
      }),
    );
    prisma.objetivos.findFirst.mockResolvedValue(null);
    await expect(
      service.create(user, { objetivo_id: 4, titulo: "Não fumar" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.acompanhamentos.create).toHaveBeenCalledTimes(1);
  });

  it("registra múltiplos eventos reais sem criar tarefas ou dias vazios", async () => {
    const { prisma, service } = setup();
    prisma.acompanhamentos.findFirst.mockResolvedValue({ id: 11 });
    prisma.ocorrencias_acompanhamento.create
      .mockResolvedValueOnce({ id: 1, acompanhamento_id: 11 })
      .mockResolvedValueOnce({ id: 2, acompanhamento_id: 11 });
    expect((await service.recordOccurrence(user, 11)).id).toBe(1);
    expect((await service.recordOccurrence(user, 11)).id).toBe(2);
    expect(prisma.ocorrencias_acompanhamento.create).toHaveBeenCalledTimes(2);
    expect(prisma.ocorrencias_acompanhamento.create).toHaveBeenCalledWith({
      data: { acompanhamento_id: 11 },
    });
    expect(prisma.missoes.create).not.toHaveBeenCalled();
  });

  it("remove ocorrência somente do acompanhamento próprio e preserva tarefas ao excluir acompanhamento", async () => {
    const { prisma, service } = setup();
    prisma.acompanhamentos.findFirst.mockResolvedValue({ id: 11 });
    prisma.ocorrencias_acompanhamento.deleteMany.mockResolvedValue({
      count: 1,
    });
    await service.deleteOccurrence(user, 11, 21);
    expect(prisma.ocorrencias_acompanhamento.deleteMany).toHaveBeenCalledWith({
      where: { id: 21, acompanhamento_id: 11 },
    });
    await service.delete(user, 11);
    expect(prisma.acompanhamentos.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
    expect(prisma.missoes.delete).not.toHaveBeenCalled();
    prisma.acompanhamentos.findFirst.mockResolvedValue(null);
    await expect(service.recordOccurrence(user, 11)).rejects.toMatchObject({
      status: 404,
    });
  });
});
