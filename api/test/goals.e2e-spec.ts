import { UserRecord } from "../src/auth/auth.types";
import { GoalsService } from "../src/goals/goals.service";

const user = { usuario_id: 7 } as UserRecord;
const now = new Date("2026-09-01T12:00:00.000Z");

function goal(overrides = {}) {
  return {
    id: 3,
    usuario_id: 7,
    titulo: "Consolidar escrita",
    descricao: null,
    data_alvo: null,
    status: "ativo",
    order_index: 1,
    created_at: now,
    updated_at: now,
    concluded_at: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    objetivos: {
      aggregate: jest.fn().mockResolvedValue({ _max: { order_index: 4 } }),
      create: jest.fn().mockImplementation(async ({ data }) => goal(data)),
      findFirst: jest.fn().mockResolvedValue(goal()),
      findMany: jest
        .fn()
        .mockResolvedValue([goal(), goal({ id: 8, order_index: 2 })]),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const saved = goal({ id: where.id, ...data });
        prisma.objetivos.findFirst.mockResolvedValue(saved);
        return saved;
      }),
      delete: jest.fn(),
    },
    series_recorrencia: { updateMany: jest.fn() },
    conquistas_objetivos: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(async ({ data }) => ({ id: 1, ...data })),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (operation) =>
    Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
  );
  Object.assign(prisma.objetivos, {
    findFirstOrThrow: jest
      .fn()
      .mockResolvedValue(
        goal({ missoes: [], series_recorrencia: [], acompanhamentos: [] }),
      ),
  });
  return { prisma, service: new GoalsService(prisma as never) };
}

describe("Goals", () => {
  it("creates an independent empty goal with only its own contract fields", async () => {
    const { prisma, service } = setup();
    const result = await service.create(user, {
      titulo: " Consolidar escrita ",
    });
    expect(result).toEqual({
      id: 3,
      usuario_id: 7,
      titulo: "Consolidar escrita",
      descricao: null,
      data_alvo: null,
      status: "ativo",
      order_index: 5,
      created_at: expect.any(String),
      updated_at: expect.any(String),
      concluded_at: null,
    });
    expect(prisma.objetivos.aggregate).toHaveBeenCalledWith({
      where: { usuario_id: 7 },
      _max: { order_index: true },
    });
  });

  it("starts ordering at one when the user has no goals", async () => {
    const { prisma, service } = setup();
    prisma.objetivos.aggregate.mockResolvedValue({
      _max: { order_index: null },
    });
    await expect(
      service.create(user, { titulo: "Primeiro objetivo" }),
    ).resolves.toMatchObject({ order_index: 1 });
  });

  it("lists only the authenticated user's goals in their own order", async () => {
    const { prisma, service } = setup();
    await service.list(user);
    expect(prisma.objetivos.findMany).toHaveBeenCalledWith({
      where: { usuario_id: 7 },
      orderBy: [{ order_index: "asc" }, { created_at: "asc" }, { id: "asc" }],
    });
  });

  it("edits an owned goal regardless of the persisted interface mode", async () => {
    const { prisma, service } = setup();
    const result = await service.update(user, 3, {
      titulo: "Escrever um livro",
      descricao: " Contexto ",
      data_alvo: "2026-12-01",
    });
    expect(result).toMatchObject({
      titulo: "Escrever um livro",
      descricao: "Contexto",
      data_alvo: "2026-12-01",
    });
    expect(prisma.objetivos.findFirst).toHaveBeenCalledWith({
      where: { id: 3, usuario_id: 7 },
    });
    await expect(
      service.update(user, 3, { data_alvo: null, descricao: null }),
    ).resolves.toMatchObject({ data_alvo: null, descricao: null });
  });

  it.each(["ativo", "pausado", "concluido", "abandonado"])(
    "sets %s with the corresponding conclusion date",
    async (status) => {
      const { prisma, service } = setup();
      const result = await service.updateStatus(user, 3, status);
      expect(result.status).toBe(status);
      expect(result.concluded_at).toEqual(
        status === "concluido" ? expect.any(String) : null,
      );
      expect(prisma.series_recorrencia.updateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid titles, dates and states without writing", async () => {
    const { prisma, service } = setup();
    await expect(service.create(user, { titulo: " " })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.update(user, 3, { data_alvo: "2026-02-30" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateStatus(user, 3, "invalido"),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.objetivos.create).not.toHaveBeenCalled();
    expect(prisma.objetivos.update).not.toHaveBeenCalled();
  });

  it("reorders the user's goals without an intermediate grouping", async () => {
    const { prisma, service } = setup();
    await service.reorder(user, { objetivo_ids: [8, 3] });
    expect(prisma.objetivos.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: [8, 3] }, usuario_id: 7 },
    });
    expect(prisma.objetivos.update).toHaveBeenNthCalledWith(1, {
      where: { id: 8 },
      data: { order_index: 1, updated_at: expect.any(Date) },
    });
    expect(prisma.objetivos.update).toHaveBeenNthCalledWith(2, {
      where: { id: 3 },
      data: { order_index: 2, updated_at: expect.any(Date) },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([{ ids: [] }, { ids: [3, 3] }, { ids: [0] }, { ids: ["3"] }])(
    "rejects invalid ordering payload $ids",
    async ({ ids }) => {
      const { prisma, service } = setup();
      await expect(
        service.reorder(user, { objetivo_ids: ids }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.objetivos.update).not.toHaveBeenCalled();
    },
  );

  it("rejects reordering goals outside the user's ownership", async () => {
    const { prisma, service } = setup();
    prisma.objetivos.findMany.mockResolvedValue([goal()]);
    await expect(
      service.reorder(user, { objetivo_ids: [3, 99] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects update, status and deletion of unowned goals", async () => {
    const { prisma, service } = setup();
    prisma.objetivos.findFirst.mockResolvedValue(null);
    await expect(
      service.update(user, 99, { titulo: "Outro" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateStatus(user, 99, "concluido"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.delete(user, 99)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.objetivos.update).not.toHaveBeenCalled();
    expect(prisma.objetivos.delete).not.toHaveBeenCalled();
  });

  it("deactivates only until-objective series before deleting an owned goal", async () => {
    const { prisma, service } = setup();
    await service.delete(user, 3);
    expect(prisma.series_recorrencia.updateMany).toHaveBeenCalledWith({
      where: { objetivo_id: 3, termination_policy: "ate_objetivo" },
      data: { ativo: false },
    });
    expect(prisma.objetivos.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(
      prisma.series_recorrencia.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.objetivos.delete.mock.invocationCallOrder[0]);
  });
});
