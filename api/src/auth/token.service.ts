import { createHmac, timingSafeEqual } from "node:crypto"

import { Injectable } from "@nestjs/common"

type TokenPayload = {
  sub: number
  email: string
  version?: number
  exp?: number
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url")
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value))
}

function sign(unsignedToken: string, secret: string): string {
  return createHmac("sha256", secret).update(unsignedToken).digest("base64url")
}

function getSecret(): string {
  const secret = process.env.BUNKERMODE_AUTH_SECRET?.trim()
  if (!secret) {
    throw new Error("Defina BUNKERMODE_AUTH_SECRET antes de executar o BunkerMode.")
  }
  return secret
}

@Injectable()
export class TokenService {
  generate(payload: Omit<TokenPayload, "exp">): string {
    const body: TokenPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }
    const unsignedToken = `${base64UrlJson({ alg: "HS256", typ: "JWT" })}.${base64UrlJson(body)}`
    return `${unsignedToken}.${sign(unsignedToken, getSecret())}`
  }

  decode(token: string): TokenPayload {
    const [encodedHeader, encodedPayload, signature] = token.split(".")
    if (!encodedHeader || !encodedPayload || !signature) {
      throw new Error("Token inválido.")
    }

    const unsignedToken = `${encodedHeader}.${encodedPayload}`
    const expected = Buffer.from(sign(unsignedToken, getSecret()))
    const received = Buffer.from(signature)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error("Token inválido.")
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TokenPayload
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expirado.")
    }
    return payload
  }
}
