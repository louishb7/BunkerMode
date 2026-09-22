import { createHash } from "node:crypto"
import { INestApplication, Logger } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request = require("supertest")
import { AuthModule } from "../src/auth/auth.module"
import { AuthService } from "../src/auth/auth.service"
import { EmailService, ResendEmailService } from "../src/auth/email.service"
import { PasswordResetService, FORGOT_PASSWORD_MESSAGE } from "../src/auth/password-reset.service"
import { AuthRateLimitService } from "../src/auth/rate-limit.service"
import { TokenService } from "../src/auth/token.service"
import { PrismaService } from "../src/prisma/prisma.service"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = testDatabaseUrl ? describe : describe.skip

describeDatabase("Password reset HTTP and PostgreSQL", () => {
  let app: INestApplication
  let prisma: PrismaService
  let auth: AuthService
  let reset: PasswordResetService
  let userId: number
  let email: string
  let previousToken: string
  const delivered: Array<{ email: string; token: string }> = []
  const sender = {
    sendPasswordReset: jest.fn(async (recipient: string, link: string) => {
      delivered.push({ email: recipient, token: new URL(link).searchParams.get("token")! })
    }),
  }
  const environment = { ...process.env }

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl
    process.env.BUNKERMODE_AUTH_SECRET = "password-reset-test-secret"
    process.env.RESEND_API_KEY = "test-only"
    process.env.EMAIL_FROM = "BunkerMode <test@example.com>"
    process.env.FRONTEND_URL = "https://bunker.example.com"
  })
  beforeEach(async () => {
    delivered.length = 0
    sender.sendPasswordReset.mockClear()
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(EmailService)
      .useValue(sender)
      .compile()
    app = module.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    auth = app.get(AuthService)
    reset = app.get(PasswordResetService)
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    email = `${suffix}@example.com`
    const user = await auth.register({ usuario: `reset-${suffix}`, email, senha: "abcde1" })
    userId = user.usuario_id
    previousToken = (await auth.login({ email, senha: "abcde1" })).access_token
  })
  afterEach(async () => {
    await reset.onModuleDestroy()
    await prisma.usuarios.delete({ where: { usuario_id: userId } })
    await app.close()
  })
  afterAll(() => {
    process.env = environment
  })

  async function forgot(address = email) {
    const result = await request(app.getHttpServer())
      .post("/api/v2/auth/forgot-password")
      .send({ email: address })
      .expect(200)
    await reset.onModuleDestroy()
    return result
  }
  function submit(token: string, password = "novaSenha2") {
    return request(app.getHttpServer())
      .post("/api/v2/auth/reset-password")
      .send({ token, password })
  }

  it("returns equivalent public responses and stores only a hash with a 30 minute expiration", async () => {
    const known = await forgot(` ${email.toUpperCase()} `)
    const unknown = await forgot("absent@example.com")
    expect(known.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE })
    expect(unknown.body).toEqual(known.body)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].email).toBe(email)
    expect(delivered[0].token).toMatch(/^[a-f0-9]{64}$/)
    const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId } })
    expect(row.tokenHash).toBe(createHash("sha256").update(delivered[0].token).digest("hex"))
    expect(JSON.stringify(row)).not.toContain(delivered[0].token)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(29 * 60_000)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
      30 * 60_000 + 1000
    )
  })

  it("changes credentials, consumes all pending resets and revokes versioned and legacy sessions", async () => {
    const legacy = new TokenService().generate({ sub: userId, email })
    await auth.getUserFromToken(legacy)
    await forgot()
    await forgot()
    await submit(delivered[0].token).expect(200)
    await request(app.getHttpServer())
      .post("/api/v2/auth/login")
      .send({ email, senha: "abcde1" })
      .expect(401)
    const login = await request(app.getHttpServer())
      .post("/api/v2/auth/login")
      .send({ email, senha: "novaSenha2" })
      .expect(200)
    for (const token of [previousToken, legacy]) {
      await request(app.getHttpServer())
        .get("/api/v2/usuarios/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(401)
    }
    await request(app.getHttpServer())
      .get("/api/v2/usuarios/me")
      .set("Authorization", `Bearer ${login.body.access_token}`)
      .expect(200)
    await submit(delivered[0].token).expect(400)
    await submit(delivered[1].token).expect(400)
    const user = await prisma.usuarios.findUniqueOrThrow({ where: { usuario_id: userId } })
    expect(user.auth_version).toBe(1)
    expect(user.senha_hash).toMatch(/^scrypt\$/)
    expect(await prisma.passwordReset.count({ where: { userId, usedAt: null } })).toBe(0)
  })

  it("rejects expired, nonexistent, malformed and invalid-password requests without changing credentials", async () => {
    await forgot()
    const token = delivered[0].token
    await submit(token, "abcd!1").expect(400)
    expect(await prisma.passwordReset.count({ where: { userId, usedAt: null } })).toBe(1)
    await submit("0".repeat(64)).expect(400)
    await submit("invalid").expect(400)
    await prisma.passwordReset.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    await submit(token).expect(400)
    await expect(auth.login({ email, senha: "abcde1" })).resolves.toHaveProperty("access_token")
    await expect(auth.getUserFromToken(previousToken)).resolves.toHaveProperty("usuario_id", userId)
  })

  it.each([false, true])(
    "allows only one concurrent reset, different tokens=%s",
    async (different) => {
      await forgot()
      await forgot()
      const results = await Promise.all([
        submit(delivered[0].token, "primeira1"),
        submit(delivered[different ? 1 : 0].token, "segunda2"),
      ])
      expect(results.map((result) => result.status).sort()).toEqual([200, 400])
      const winner = results[0].status === 200 ? "primeira1" : "segunda2"
      await expect(auth.login({ email, senha: winner })).resolves.toHaveProperty("access_token")
      expect(
        (await prisma.usuarios.findUniqueOrThrow({ where: { usuario_id: userId } })).auth_version
      ).toBe(1)
    }
  )

  it("rolls back token consumption if updating credentials fails", async () => {
    await forgot()
    // Força falha real no incremento, depois de consumir o token dentro da transação.
    await prisma.usuarios.update({
      where: { usuario_id: userId },
      data: { auth_version: 2147483647 },
    })
    await expect(
      reset.reset({ token: delivered[0].token, password: "novaSenha2" })
    ).rejects.toThrow()
    expect(await prisma.passwordReset.count({ where: { userId, usedAt: null } })).toBe(1)
    await expect(auth.login({ email, senha: "abcde1" })).resolves.toHaveProperty("access_token")
  })

  it("limits recovery per IP and per normalized email, and reset attempts", async () => {
    for (let i = 0; i < 5; i++) await forgot(`absent-${i}@example.com`)
    await request(app.getHttpServer())
      .post("/api/v2/auth/forgot-password")
      .send({ email })
      .expect(429)
    for (let i = 0; i < 3; i++) reset.forgot({ email })
    expect(() => reset.forgot({ email: ` ${email.toUpperCase()} ` })).toThrow("Muitas tentativas")
    for (let i = 0; i < 10; i++) await submit("invalid").expect(400)
    await submit("invalid").expect(429)
  })

  it("does not expose delivery failures, addresses or tokens in logs or responses", async () => {
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation(() => {})
    sender.sendPasswordReset.mockRejectedValueOnce(new Error("provider secret"))
    try {
      expect((await forgot()).body).toEqual({ message: FORGOT_PASSWORD_MESSAGE })
      expect(log).toHaveBeenCalledWith("Não foi possível enviar instruções de recuperação.")
      expect(JSON.stringify(log.mock.calls)).not.toContain(email)
      expect(JSON.stringify(log.mock.calls)).not.toContain("provider secret")
    } finally {
      log.mockRestore()
    }
  })

  it("returns the same response for inactive accounts and never sends them a token", async () => {
    await prisma.usuarios.update({ where: { usuario_id: userId }, data: { ativo: false } })
    expect((await forgot()).body).toEqual({ message: FORGOT_PASSWORD_MESSAGE })
    expect(delivered).toHaveLength(0)
    expect(await prisma.passwordReset.count({ where: { userId } })).toBe(0)
  })

  it("reports missing email configuration consistently without exposing secrets", async () => {
    const key = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      const responses = []
      for (const address of [email, "absent@example.com"]) {
        responses.push(
          await request(app.getHttpServer())
            .post("/api/v2/auth/forgot-password")
            .send({ email: address })
            .expect(503)
        )
      }
      expect(responses[0].body).toEqual(responses[1].body)
      expect(responses[0].body.message).toBe(
        "Recuperação de senha indisponível. Tente novamente mais tarde."
      )
      expect(delivered).toHaveLength(0)
    } finally {
      process.env.RESEND_API_KEY = key
    }
  })
})

describe("Email adapter", () => {
  it("sends through the configured backend provider and sanitizes provider errors", async () => {
    const env = { ...process.env }
    process.env.RESEND_API_KEY = "test-key"
    process.env.EMAIL_FROM = "test@example.com"
    process.env.FRONTEND_URL = "https://bunker.example.com"
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }))
    try {
      await new ResendEmailService().sendPasswordReset(
        "person@example.com",
        "https://bunker.example.com/reset-password?token=test"
      )
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({ method: "POST" })
      )
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
      expect(body.to).toEqual(["person@example.com"])
      expect(body.text).toContain("30 minutos")
      fetchMock.mockRejectedValueOnce(new Error("sensitive provider response"))
      await expect(
        new ResendEmailService().sendPasswordReset("person@example.com", "secret-link")
      ).rejects.toThrow("Falha no envio do e-mail de recuperação.")
    } finally {
      fetchMock.mockRestore()
      process.env = env
    }
  })

  it("rate limit recovers after its window", () => {
    jest.useFakeTimers()
    try {
      const limiter = new AuthRateLimitService()
      limiter.check("forgot:test", 1, 1000)
      expect(() => limiter.check("forgot:test", 1, 1000)).toThrow()
      jest.advanceTimersByTime(1000)
      expect(() => limiter.check("forgot:test", 1, 1000)).not.toThrow()
    } finally {
      jest.useRealTimers()
    }
  })
})
