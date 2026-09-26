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
export const CATEGORIES = [
  "Trabalho",
  "Moradia",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Estudos",
  "Lazer",
  "Outros",
  "Ajuste",
];
type Payload = Record<string, unknown>;
function body(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Dados financeiros inválidos.");
  return value as Payload;
}
export function cents(value: unknown, allowZero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
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

  async totals(
    user: UserRecord,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    saldo_centavos: number;
    reservado_centavos: number;
    livre_centavos: number;
  }> {
    if (!tx)
      return this.prisma.$transaction((current) => this.totals(user, current), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    const [groups, reserves] = await Promise.all([
      tx.lancamentos_financeiros.groupBy({
        by: ["tipo"],
        where: { usuario_id: user.usuario_id },
        _sum: { valor_centavos: true },
      }),
      tx.reservas_financeiras.aggregate({
        where: { usuario_id: user.usuario_id },
        _sum: { valor_centavos: true },
      }),
    ]);
    const saldo_centavos = safeTotal(
      groups.reduce(
        (sum, g) =>
          sum +
          (g.tipo === "receita" || g.tipo === "ajuste_entrada" ? 1 : -1) *
            (g._sum.valor_centavos ?? 0),
        0,
      ),
    );
    const reservado_centavos = safeTotal(reserves._sum.valor_centavos ?? 0);
    return {
      saldo_centavos,
      reservado_centavos,
      livre_centavos: safeTotal(saldo_centavos - reservado_centavos),
    };
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
    // Uma fotografia consistente para saldo, reservas e movimentos.
    return this.prisma.$transaction(
      async (tx) => {
        const [totals, lancamentos, reservas] = await Promise.all([
          this.totals(user, tx),
          tx.lancamentos_financeiros.findMany({
            where: {
              usuario_id: user.usuario_id,
              data: { gte: start, lt: end },
            },
            orderBy: [{ data: "desc" }, { id: "desc" }],
          }),
          tx.reservas_financeiras.findMany({
            where: { usuario_id: user.usuario_id },
            orderBy: { id: "asc" },
          }),
        ]);
        return {
          mes,
          moeda: "BRL",
          ...totals,
          receitas_centavos: safeTotal(
            lancamentos
              .filter((x) => x.tipo === "receita")
              .reduce((s, x) => s + x.valor_centavos, 0),
          ),
          despesas_centavos: safeTotal(
            lancamentos
              .filter((x) => x.tipo === "despesa")
              .reduce((s, x) => s + x.valor_centavos, 0),
          ),
          lancamentos: lancamentos.map((x) => ({
            ...x,
            data: x.data.toISOString().slice(0, 10),
          })),
          reservas,
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
    const categoria = requiredText(p.categoria, "Categoria inválida.");
    if (!CATEGORIES.includes(categoria))
      throw new BadRequestException("Categoria inválida.");
    const data = parseIsoDate(p.data, "Data inválida.");
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
      categoria: tipo.startsWith("ajuste") ? "Ajuste" : categoria,
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

  saveReserve(user: UserRecord, raw: unknown, id?: number) {
    const patch = body(raw);
    return this.write(user, async (tx) => {
      const existing =
        id === undefined
          ? null
          : await tx.reservas_financeiras.findFirst({
              where: {
                id: positiveInt(id, "Reserva inválida."),
                usuario_id: user.usuario_id,
              },
            });
      if (id !== undefined && !existing)
        throw new NotFoundException("Reserva não encontrada.");
      const p = { ...existing, ...patch };
      const objetivo_id =
        p.objetivo_id == null
          ? null
          : positiveInt(p.objetivo_id, "Objetivo inválido.");
      if (objetivo_id !== null) {
        const goal = await tx.objetivos.findFirst({
          where: { id: objetivo_id, usuario_id: user.usuario_id },
        });
        if (!goal) throw new NotFoundException("Objetivo não encontrado.");
      }
      const data = {
        titulo: requiredText(
          p.titulo,
          "Nome da reserva obrigatório, com até 200 caracteres.",
          200,
        ),
        objetivo_id,
        valor_centavos: cents(p.valor_centavos ?? 0, true),
        alvo_centavos: p.alvo_centavos == null ? null : cents(p.alvo_centavos),
      };
      // Despesas reais podem consumir saldo reservado. Não escondemos esse déficit;
      // só impedimos ampliar reservas sem recursos livres para cobrir o acréscimo.
      const increase = data.valor_centavos - (existing?.valor_centavos ?? 0);
      if (
        increase > 0 &&
        increase > (await this.totals(user, tx)).livre_centavos
      )
        throw new BadRequestException(
          "Saldo livre insuficiente para ampliar esta reserva.",
        );
      return existing
        ? tx.reservas_financeiras.update({ where: { id: existing.id }, data })
        : tx.reservas_financeiras.create({
            data: { ...data, usuario_id: user.usuario_id },
          });
    });
  }
  deleteReserve(user: UserRecord, id: number) {
    return this.write(user, async (tx) => {
      const deleted = await tx.reservas_financeiras.deleteMany({
        where: {
          id: positiveInt(id, "Reserva inválida."),
          usuario_id: user.usuario_id,
        },
      });
      if (!deleted.count)
        throw new NotFoundException("Reserva não encontrada.");
    });
  }
}
