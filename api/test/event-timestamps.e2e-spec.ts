import { eventTimestamp } from "../src/common/domain-helpers";
import { TasksService } from "../src/tasks/tasks.service";
import { OperationalCalendarService } from "../src/calendar/operational-calendar.service";
import { TrackersService } from "../src/goals/trackers.service";
import { toTaskHistoryEventResponse } from "../src/tasks/task-response";

describe("Tempo de ocorrência e tempo de recebimento", () => {
  const event = new Date("2026-10-04T18:00:00.000Z");
  const receipt = new Date("2026-10-05T18:00:00.000Z");
  const owner = { usuario_id: 7 } as never;
  afterEach(() => jest.useRealTimers());

  it("conclusão sincronizada no dia seguinte preserva completed_at e auditoria no dia do evento", async () => {
    jest.useFakeTimers().setSystemTime(receipt);
    const prisma = {
      missoes: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            titulo: "Ler",
            status: "PENDENTE",
            completed_at: null,
          }),
        update: jest
          .fn()
          .mockResolvedValue({ status: "CONCLUIDA", completed_at: event }),
      },
      auditoria_eventos: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const service = new TasksService(
      prisma as never,
      new OperationalCalendarService(),
    );
    await service.complete(10, owner, event.toISOString());
    expect(prisma.missoes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "CONCLUIDA", completed_at: event },
      }),
    );
    const data = prisma.auditoria_eventos.create.mock.calls[0][0].data;
    expect(data.occurred_at).toEqual(event);
    expect(data).not.toHaveProperty("criado_em");
  });

  it("ocorrência de acompanhamento sincronizada no dia seguinte preserva o evento e deixa created_at no servidor", async () => {
    jest.useFakeTimers().setSystemTime(receipt);
    const prisma = {
      acompanhamentos: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      ocorrencias_acompanhamento: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 1, occurred_at: event, amount: null }),
      },
    };
    await new TrackersService(prisma as never).recordOccurrence(owner, 3, {
      occurred_at: event.toISOString(),
    });
    expect(prisma.ocorrencias_acompanhamento.create).toHaveBeenCalledWith({
      data: { acompanhamento_id: 3, occurred_at: event },
    });
  });

  it("histórico expõe ocorrência e recebimento separadamente sem inventar datas de eventos antigos", () => {
    const legacy = {
      evento_id: 1,
      missao_id: 10,
      usuario_id: 7,
      acao: "tarefa_criada",
      detalhes: "Criada",
      criado_em: receipt,
      occurred_at: null,
    };
    expect(toTaskHistoryEventResponse(legacy)).toMatchObject({
      criado_em: receipt.toISOString(),
      occurred_at: receipt.toISOString(),
    });
    expect(
      toTaskHistoryEventResponse({ ...legacy, occurred_at: event }),
    ).toMatchObject({
      criado_em: receipt.toISOString(),
      occurred_at: event.toISOString(),
    });
  });

  it("histórico ordena pelo evento mesmo quando o recebimento tem outra ordem", async () => {
    const first = { evento_id: 1, criado_em: receipt, occurred_at: event };
    const second = {
      evento_id: 2,
      criado_em: new Date("2026-10-05T12:00:00Z"),
      occurred_at: null,
    };
    const prisma = {
      missoes: { findFirst: jest.fn().mockResolvedValue({}) },
      auditoria_eventos: {
        findMany: jest.fn().mockResolvedValue([second, first]),
      },
    };
    expect(
      await new TasksService(
        prisma as never,
        new OperationalCalendarService(),
      ).taskHistory(10, owner),
    ).toEqual([first, second]);
  });

  it("aceita ISO com fuso e rejeita data sem fuso, calendário inválido e futuro além da tolerância", () => {
    expect(eventTimestamp("2026-10-04T15:00:00-03:00", receipt)).toEqual(event);
    expect(eventTimestamp(undefined, receipt)).toEqual(receipt);
    for (const value of [
      null,
      "2026-10-04",
      "2026-10-04T15:00:00",
      "2026-02-30T15:00:00Z",
      "2026-10-04T24:00:00Z",
      "2026-10-04T15:60:00Z",
      "2026-10-04T15:00:00+03:60",
      "2026-10-06T18:00:00Z",
      123,
    ])
      expect(() => eventTimestamp(value, receipt)).toThrow();
  });
});
