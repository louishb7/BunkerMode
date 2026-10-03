import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UserRecord } from "../auth/auth.types";
import { OperationalCalendarService } from "../calendar/operational-calendar.service";
import {
  parseIsoDate,
  positiveInt,
  requiredText,
} from "../common/domain-helpers";
import { PrismaService } from "../prisma/prisma.service";

const TYPES = ["receita", "despesa", "ajuste_entrada", "ajuste_saida"];
type Payload = Record<string, unknown>;
function body(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Dados financeiros inválidos.");
  return value as Payload;
}
export function cents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new BadRequestException(
      "Informe um valor válido em centavos inteiros.",
    );
  return value;
}
function safeTotal(value: number) {
  if (!Number.isSafeInteger(value))
    throw new BadRequestException(
      "Total financeiro excede o limite suportado.",
    );
  return value;
}

@Injectable()
export class FinancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: OperationalCalendarService,
  ) {}

  private today(user: UserRecord) {
    return this.calendar.currentDateFor(new Date(), user.timezone);
  }

  async registeredBalance(
    user: UserRecord,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const groups = await tx.lancamentos_financeiros.groupBy({
      by: ["tipo"],
      where: { usuario_id: user.usuario_id },
      _sum: { valor_centavos: true },
    });
    return safeTotal(
      groups.reduce(
        (sum, group) =>
          sum +
          (group.tipo === "receita" || group.tipo === "ajuste_entrada"
            ? 1
            : -1) *
            (group._sum.valor_centavos ?? 0),
        0,
      ),
    );
  }

  async overview(user: UserRecord, month?: string) {
    const mes = month ?? this.today(user).slice(0, 7);
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ||
      Number(mes.slice(0, 4)) < 1900 ||
      Number(mes.slice(0, 4)) > 9998
    )
      throw new BadRequestException("Mês inválido.");
    const start = new Date(`${mes}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    // O saldo e seu histórico são globais; resumo e série são do mês selecionado.
    return this.prisma.$transaction(
      async (tx) => {
        const [saldo_centavos, daily, lancamentos] = await Promise.all([
          this.registeredBalance(user, tx),
          tx.lancamentos_financeiros.groupBy({
            by: ["data", "tipo"],
            where: {
              usuario_id: user.usuario_id,
              data: { gte: start, lt: end },
            },
            _sum: { valor_centavos: true },
          }),
          tx.lancamentos_financeiros.findMany({
            where: { usuario_id: user.usuario_id },
            orderBy: [{ data: "desc" }, { id: "desc" }],
          }),
        ]);
        const incomes = new Map<string, number>();
        const expenses = new Map<string, number>();
        for (const item of daily) {
          const day = item.data.toISOString().slice(0, 10);
          const amount = item._sum.valor_centavos ?? 0;
          if (item.tipo === "receita")
            incomes.set(day, (incomes.get(day) ?? 0) + amount);
          if (item.tipo === "despesa")
            expenses.set(day, (expenses.get(day) ?? 0) + amount);
        }
        const receitas_centavos = safeTotal(
          [...incomes.values()].reduce((sum, value) => sum + value, 0),
        );
        const despesas_centavos = safeTotal(
          [...expenses.values()].reduce((sum, value) => sum + value, 0),
        );
        let running = 0,
          incoming = 0,
          outgoing = 0;
        const serie_diaria = [];
        for (
          let current = new Date(start);
          current < end;
          current.setUTCDate(current.getUTCDate() + 1)
        ) {
          const day = current.toISOString().slice(0, 10);
          incoming = safeTotal(incoming + (incomes.get(day) ?? 0));
          outgoing = safeTotal(outgoing + (expenses.get(day) ?? 0));
          running = safeTotal(incoming - outgoing);
          serie_diaria.push({
            data: day,
            resultado_centavos: running,
            receitas_centavos: incoming,
            despesas_centavos: outgoing,
          });
        }
        return {
          mes,
          moeda: "BRL",
          saldo_centavos,
          resultado_centavos: safeTotal(receitas_centavos - despesas_centavos),
          receitas_centavos,
          despesas_centavos,
          serie_diaria,
          lancamentos: lancamentos.map((x) => ({
            ...x,
            data: x.data.toISOString().slice(0, 10),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  // Todo comando financeiro serializa pelo dono, inclusive edição/exclusão de lançamentos.
  private write<T>(
    user: UserRecord,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT usuario_id FROM usuarios WHERE usuario_id = ${user.usuario_id} FOR UPDATE`;
      return work(tx);
    });
  }

  private entryData(user: UserRecord, raw: unknown) {
    const p = body(raw);
    const tipo = requiredText(p.tipo, "Tipo de lançamento inválido.");
    if (!TYPES.includes(tipo))
      throw new BadRequestException("Tipo de lançamento inválido.");
    const data = parseIsoDate(p.data ?? this.today(user), "Data inválida.");
    if (!data || data.toISOString().slice(0, 10) > this.today(user))
      throw new BadRequestException(
        "Registre apenas movimentações já realizadas.",
      );
    return {
      titulo: requiredText(
        p.titulo,
        "Descrição obrigatória, com até 200 caracteres.",
        200,
      ),
      tipo,
      data,
      valor_centavos: cents(p.valor_centavos),
    };
  }

  createEntry(user: UserRecord, raw: unknown) {
    const data = this.entryData(user, raw);
    return this.write(user, (tx) =>
      tx.lancamentos_financeiros.create({
        data: { ...data, usuario_id: user.usuario_id },
      }),
    );
  }
  updateEntry(user: UserRecord, id: number, raw: unknown) {
    return this.write(user, async (tx) => {
      const entry = await tx.lancamentos_financeiros.findFirst({
        where: {
          id: positiveInt(id, "Lançamento inválido."),
          usuario_id: user.usuario_id,
        },
      });
      if (!entry) throw new NotFoundException("Lançamento não encontrado.");
      const p = body(raw);
      return tx.lancamentos_financeiros.update({
        where: { id: entry.id },
        data: this.entryData(user, {
          ...entry,
          data: entry.data.toISOString().slice(0, 10),
          ...p,
        }),
      });
    });
  }
  deleteEntry(user: UserRecord, id: number) {
    return this.write(user, async (tx) => {
      const deleted = await tx.lancamentos_financeiros.deleteMany({
        where: {
          id: positiveInt(id, "Lançamento inválido."),
          usuario_id: user.usuario_id,
        },
      });
      if (!deleted.count)
        throw new NotFoundException("Lançamento não encontrado.");
    });
  }
}
