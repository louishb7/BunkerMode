import { HttpException, HttpStatus, Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"

import { PrismaService } from "../prisma/prisma.service"
import { UserRecord } from "./auth.types"
import { hashPassword, verifyPassword } from "./password"
import { TokenService } from "./token.service"
import { validateNewPassword } from "./password-policy"

type RegisterPayload = {
  usuario?: unknown
  email?: unknown
  senha?: unknown
}

type LoginPayload = {
  email?: unknown
  senha?: unknown
}

const VALID_MODULE_KEYS = new Set(["tasks", "objectives"])

function requireText(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new HttpException(message, HttpStatus.BAD_REQUEST)
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new HttpException(message, HttpStatus.BAD_REQUEST)
  }
  return normalized
}

export function normalizeEmail(value: unknown): string {
  const raw = requireText(value, "E-mail inválido.")
  if (raw.length > 254) {
    throw new HttpException("E-mail deve ter no máximo 254 caracteres.", HttpStatus.BAD_REQUEST)
  }
  const email = raw.toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpException("E-mail inválido.", HttpStatus.BAD_REQUEST)
  }
  return email
}

function normalizeUsername(value: unknown): string {
  const raw = requireText(value, "Usuário deve ter entre 3 e 32 caracteres.")
  if (raw.length < 3 || raw.length > 32) {
    throw new HttpException("Usuário deve ter entre 3 e 32 caracteres.", HttpStatus.BAD_REQUEST)
  }
  const usuario = raw.toLowerCase()
  if (!/^[a-z0-9._-]+$/.test(usuario)) {
    throw new HttpException("Usuário deve usar apenas letras, números, ponto, hífen ou sublinhado.", HttpStatus.BAD_REQUEST)
  }
  return usuario
}

function normalizeEnabledModules(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new HttpException("Preferência de módulos inválida.", HttpStatus.BAD_REQUEST)
  }

  const enabledModules = (payload as { enabled_modules?: unknown }).enabled_modules
  if (!Array.isArray(enabledModules) || !enabledModules.every((moduleKey) => typeof moduleKey === "string")) {
    throw new HttpException("Módulos habilitados devem ser uma lista de chaves válidas.", HttpStatus.BAD_REQUEST)
  }
  if (enabledModules.some((moduleKey) => !VALID_MODULE_KEYS.has(moduleKey))) {
    throw new HttpException("Módulo inválido.", HttpStatus.BAD_REQUEST)
  }
  if (new Set(enabledModules).size !== enabledModules.length) {
    throw new HttpException("Módulos habilitados não podem conter duplicatas.", HttpStatus.BAD_REQUEST)
  }

  return enabledModules
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async register(payload: RegisterPayload): Promise<UserRecord> {
    const usuario = normalizeUsername(payload.usuario)
    const email = normalizeEmail(payload.email)
    const senha = validateNewPassword(payload.senha)

    try {
      return await this.prisma.usuarios.create({
        data: {
          usuario,
          email,
          senha_hash: hashPassword(senha),
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpException("E-mail ou usuário já está em uso.", HttpStatus.BAD_REQUEST)
      }
      throw error
    }
  }

  async login(payload: LoginPayload): Promise<{ access_token: string; token_type: "bearer"; usuario: UserRecord }> {
    const identificador = requireText(payload.email, "Credenciais inválidas.")
    if (identificador.length > 254 || typeof payload.senha !== "string" || payload.senha.length === 0) {
      throw new HttpException("Credenciais inválidas.", HttpStatus.UNAUTHORIZED)
    }
    const senha = payload.senha
    const email = identificador.toLowerCase()
    const usuarioLogin = identificador.toLowerCase()

    const usuario = identificador.includes("@")
      ? await this.prisma.usuarios.findUnique({ where: { email } })
      : await this.prisma.usuarios.findUnique({ where: { usuario: usuarioLogin } })

    if (!usuario || !verifyPassword(senha, usuario.senha_hash)) {
      throw new HttpException("Credenciais inválidas.", HttpStatus.UNAUTHORIZED)
    }
    if (!usuario.ativo) {
      throw new HttpException("Usuário inativo.", HttpStatus.UNAUTHORIZED)
    }

    return {
      access_token: this.tokenService.generate({ sub: usuario.usuario_id, email: usuario.email, version: usuario.auth_version }),
      token_type: "bearer",
      usuario,
    }
  }

  async getUserFromToken(token: string): Promise<UserRecord> {
    const payload = this.tokenService.decode(token)
    const usuario = await this.prisma.usuarios.findUnique({ where: { usuario_id: payload.sub } })
    if (!usuario) {
      throw new HttpException("Usuário autenticado não encontrado.", HttpStatus.UNAUTHORIZED)
    }
    if (!usuario.ativo) {
      throw new HttpException("Usuário inativo.", HttpStatus.UNAUTHORIZED)
    }
    // JWTs anteriores à migration equivalem à versão inicial, nunca às versões após reset.
    if ((payload.version ?? 0) !== usuario.auth_version) {
      throw new HttpException("Sessão expirada. Faça login novamente.", HttpStatus.UNAUTHORIZED)
    }
    return usuario
  }

  async updateEnabledModules(usuarioId: number, payload: unknown): Promise<UserRecord> {
    const enabledModules = normalizeEnabledModules(payload)
    return this.prisma.usuarios.update({
      where: { usuario_id: usuarioId },
      data: { enabled_modules: enabledModules },
    })
  }
}
