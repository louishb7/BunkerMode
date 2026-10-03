import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly operationTransaction =
    new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("Defina DATABASE_URL antes de executar o BunkerMode.");
    }

    super({
      adapter: new PrismaPg({ connectionString }),
    });
    // Domain services keep their existing Prisma calls. During an offline operation,
    // they all use the same transaction, including their nested $transaction calls.
    return new Proxy(this, {
      get(target, property) {
        const transaction = target.operationTransaction.getStore();
        if (transaction && property === "$transaction") {
          return async (
            work: (db: Prisma.TransactionClient) => Promise<unknown>,
          ) => work(transaction);
        }
        if (transaction && property in transaction) {
          const value = transaction[property as keyof Prisma.TransactionClient];
          return typeof value === "function" ? value.bind(transaction) : value;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async withOperationTransaction<T>(
    work: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      (transaction) =>
        this.operationTransaction.run(transaction, () => work(transaction)),
      { timeout: 30000 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
