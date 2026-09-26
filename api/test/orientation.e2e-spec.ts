import { OrientationService } from "../src/orientation/orientation.service";
import { OperationalCalendarService } from "../src/calendar/operational-calendar.service";
import { UserRecord } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { FinancesService } from "../src/finances/finances.service";

function setup() {
  const prisma = {
    missoes: { findMany: jest.fn().mockResolvedValue([]) },
    objetivos: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const finances = {
    totals: jest
      .fn()
      .mockResolvedValue({
        saldo_centavos: 100,
        reservado_centavos: 0,
        livre_centavos: 100,
      }),
  };
  const service = new OrientationService(
    prisma as unknown as PrismaService,
    new OperationalCalendarService(),
    finances as unknown as FinancesService,
  );
  return { prisma, finances, service };
}
const user = (modules: string[]) =>
  ({
    usuario_id: 5,
    enabled_modules: modules,
    timezone: "America/Recife",
  }) as UserRecord;

describe("Projeção de orientação", () => {
  it("não consulta módulos desativados nem retorna seus dados", async () => {
    const { prisma, finances, service } = setup();
    const result = await service.read(user([]));
    expect(result).toMatchObject({
      tarefas: [],
      direcoes: [],
      financeiro: null,
      falhas: {},
    });
    expect(prisma.missoes.findMany).not.toHaveBeenCalled();
    expect(prisma.objetivos.findMany).not.toHaveBeenCalled();
    expect(finances.totals).not.toHaveBeenCalled();
    await service.read(user(["objectives"]));
    expect(prisma.objetivos.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuario_id: 5, status: "ativo" },
        take: 3,
      }),
    );
    expect(
      prisma.objetivos.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty("reservas");
    expect(
      prisma.objetivos.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty("missoes");
  });
  it("não lê tarefas após falha na preparação, mantendo direções independentes", async () => {
    const { prisma, service } = setup();
    await service.read(user(["tasks", "objectives"]), false);
    expect(prisma.missoes.findMany).not.toHaveBeenCalled();
    expect(
      prisma.objetivos.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty("missoes");
  });
  it("uma falha local não derruba os outros estados nem inventa déficit", async () => {
    const { prisma, finances, service } = setup();
    prisma.missoes.findMany.mockRejectedValue(
      new Error("internal private error"),
    );
    prisma.objetivos.findMany.mockResolvedValue([
      {
        id: 8,
        titulo: "Direção",
        status: "ativo",
        data_alvo: null,
        acompanhamentos: [],
        missoes: [],
        reservas: [],
      },
    ]);
    const result = await service.read(
      user(["tasks", "objectives", "finances"]),
    );
    expect(result.direcoes).toHaveLength(1);
    expect(result.falhas.tarefas).toBeTruthy();
    expect(result.financeiro).toBeNull();
    expect(JSON.stringify(result)).not.toContain("internal private error");
    finances.totals.mockResolvedValue({
      saldo_centavos: 100,
      reservado_centavos: 200,
      livre_centavos: -100,
    });
    expect((await service.read(user(["finances"]))).financeiro).toEqual({
      livre_centavos: -100,
    });
  });
});
