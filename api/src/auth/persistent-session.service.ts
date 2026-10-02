import { createHash, randomBytes } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "./token.service";

const invalid = () =>
  new HttpException("Sessão inválida ou revogada.", HttpStatus.UNAUTHORIZED);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const valid = (token: unknown): token is string =>
  typeof token === "string" && /^[a-f0-9]{64}$/.test(token);

@Injectable()
export class PersistentSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async create(userId: number) {
    const user = await this.prisma.usuarios.findUnique({
      where: { usuario_id: userId },
    });
    if (!user || !user.ativo) throw invalid();
    const refresh_token = randomBytes(32).toString("hex");
    await this.prisma.persistentSession.create({
      data: {
        userId,
        tokenHash: hash(refresh_token),
        authVersion: user.auth_version,
      },
    });
    return { refresh_token };
  }

  async refresh(token: unknown) {
    if (!valid(token)) throw invalid();
    const next = randomBytes(32).toString("hex");
    const user = await this.prisma.$transaction(async (tx) => {
      const session = await tx.persistentSession.findUnique({
        where: { tokenHash: hash(token) },
      });
      if (!session || session.revokedAt) throw invalid();
      const current = await tx.usuarios.findUnique({
        where: { usuario_id: session.userId },
      });
      if (
        !current ||
        !current.ativo ||
        current.auth_version !== session.authVersion
      )
        throw invalid();
      const updated = await tx.persistentSession.updateMany({
        where: { id: session.id, tokenHash: hash(token), revokedAt: null },
        data: { tokenHash: hash(next), lastUsedAt: new Date() },
      });
      if (updated.count !== 1) throw invalid();
      return current;
    });
    return {
      access_token: this.tokens.generate({
        sub: user.usuario_id,
        email: user.email,
        version: user.auth_version,
      }),
      token_type: "bearer" as const,
      refresh_token: next,
    };
  }

  async revoke(token: unknown) {
    if (!valid(token)) return;
    await this.prisma.persistentSession.updateMany({
      where: { tokenHash: hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
