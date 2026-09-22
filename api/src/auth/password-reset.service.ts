import { createHash, randomBytes } from "node:crypto"
import { BadRequestException, Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { normalizeEmail } from "./auth.service"
import { EmailService, resetEmailConfiguration } from "./email.service"
import { AuthRateLimitService } from "./rate-limit.service"
import { validateNewPassword } from "./password-policy"
import { hashPassword } from "./password"

export const FORGOT_PASSWORD_MESSAGE =
  "Se existir uma conta com esse e-mail, enviaremos as instruções para redefinir a senha."
const invalidToken = () =>
  new BadRequestException("Link inválido ou expirado. Solicite uma nova recuperação de senha.")
const digest = (token: string) => createHash("sha256").update(token).digest("hex")

@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordResetService.name)
  private readonly pending = new Set<Promise<void>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly rateLimit: AuthRateLimitService
  ) {}

  forgot(payload: { email?: unknown }) {
    const email = normalizeEmail(payload.email)
    const { frontend } = resetEmailConfiguration()
    // Aplica o mesmo limite a endereços existentes e inexistentes, entre diferentes IPs.
    this.rateLimit.check(`forgot-email:${digest(email)}`, 3, 15 * 60_000)
    // Desacopla o tempo do provider e da busca da resposta pública, sem expor existência da conta.
    const work = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.deliver(email, frontend))
      .catch(() => {
        this.logger.error("Não foi possível enviar instruções de recuperação.")
      })
      .finally(() => {
        this.pending.delete(work)
      })
    this.pending.add(work)
    return { message: FORGOT_PASSWORD_MESSAGE }
  }

  async onModuleDestroy() {
    await Promise.all(this.pending)
  }

  private async deliver(email: string, frontend: URL) {
    const user = await this.prisma.usuarios.findUnique({ where: { email } })
    if (!user?.ativo) return
    const token = randomBytes(32).toString("hex")
    await this.prisma.passwordReset.create({
      data: {
        userId: user.usuario_id,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    })
    const link = new URL("/reset-password", frontend)
    link.searchParams.set("token", token)
    await this.email.sendPasswordReset(email, link.toString())
  }

  async reset(payload: { token?: unknown; password?: unknown }) {
    if (typeof payload.token !== "string" || !/^[a-f0-9]{64}$/.test(payload.token))
      throw invalidToken()
    const tokenHash = digest(payload.token)
    const candidate = await this.prisma.passwordReset.findUnique({ where: { tokenHash } })
    if (!candidate || candidate.usedAt || candidate.expiresAt <= new Date()) throw invalidToken()
    const password = validateNewPassword(payload.password)
    const senhaHash = hashPassword(password)
    await this.prisma.$transaction(async (tx) => {
      // Serializa resets do mesmo usuário, inclusive com tokens diferentes.
      await tx.$queryRaw`SELECT usuario_id FROM usuarios WHERE usuario_id = ${candidate.userId} FOR UPDATE`
      const user = await tx.usuarios.findUnique({ where: { usuario_id: candidate.userId } })
      if (!user?.ativo) throw invalidToken()
      const now = new Date()
      const consumed = await tx.passwordReset.updateMany({
        where: { id: candidate.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      if (consumed.count !== 1) throw invalidToken()
      await tx.usuarios.update({
        where: { usuario_id: candidate.userId },
        data: { senha_hash: senhaHash, auth_version: { increment: 1 } },
      })
      await tx.passwordReset.updateMany({
        where: { userId: candidate.userId, usedAt: null },
        data: { usedAt: now },
      })
    })
    return { message: "Senha redefinida. Entre com sua nova senha." }
  }
}
