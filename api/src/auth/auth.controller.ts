import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from "@nestjs/common"

import { AuthenticatedRequest } from "./auth.types"
import { AuthGuard } from "./auth.guard"
import { AuthRateLimitService } from "./rate-limit.service"
import { AuthService } from "./auth.service"
import { toUserResponse } from "./user-response"
import { PasswordResetService } from "./password-reset.service"

type RequestLike = {
  ip?: string
  socket?: { remoteAddress?: string }
}

function clientAddress(request: RequestLike): string {
  return request.ip || request.socket?.remoteAddress || "unknown"
}

@Controller("api/v2")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post("auth/register")
  async register(@Req() request: RequestLike, @Body() payload: unknown) {
    this.rateLimit.check(`register:${clientAddress(request)}`, 5, 60_000)
    const usuario = await this.authService.register(payload ?? {})
    return toUserResponse(usuario)
  }

  @Post("auth/login")
  @HttpCode(200)
  async login(@Req() request: RequestLike, @Body() payload: unknown) {
    this.rateLimit.check(`login:${clientAddress(request)}`, 10, 60_000)
    const result = await this.authService.login(payload ?? {})
    return {
      access_token: result.access_token,
      token_type: result.token_type,
      usuario: toUserResponse(result.usuario, false),
    }
  }

  @Post("auth/forgot-password")
  @HttpCode(200)
  forgotPassword(@Req() request: RequestLike, @Body() payload: { email?: unknown }) {
    this.rateLimit.check(`forgot:${clientAddress(request)}`, 5, 15 * 60_000)
    return this.passwordReset.forgot(payload ?? {})
  }

  @Post("auth/reset-password")
  @HttpCode(200)
  resetPassword(@Req() request: RequestLike, @Body() payload: { token?: unknown; password?: unknown }) {
    this.rateLimit.check(`reset:${clientAddress(request)}`, 10, 15 * 60_000)
    return this.passwordReset.reset(payload ?? {})
  }

  @Get("usuarios/me")
  @UseGuards(AuthGuard)
  currentUser(@Req() request: AuthenticatedRequest) {
    return toUserResponse(request.currentUser!)
  }

  @Patch("usuarios/me/modulos")
  @UseGuards(AuthGuard)
  async updateEnabledModules(@Req() request: AuthenticatedRequest, @Body() payload: unknown) {
    const usuario = await this.authService.updateEnabledModules(request.currentUser!.usuario_id, payload)
    return toUserResponse(usuario)
  }
}
