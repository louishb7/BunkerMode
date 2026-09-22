import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common"

import { AuthenticatedRequest } from "./auth.types"
import { AuthService } from "./auth.service"

type HttpRequest = AuthenticatedRequest & {
  headers?: {
    authorization?: string
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>()
    const authorization = request.headers?.authorization ?? ""
    const prefix = "Bearer "

    if (!authorization.startsWith(prefix)) {
      throw new HttpException("Credenciais não fornecidas.", HttpStatus.UNAUTHORIZED)
    }

    const token = authorization.slice(prefix.length).trim()
    try {
      request.currentUser = await this.authService.getUserFromToken(token)
      return true
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw new HttpException("Token inválido.", HttpStatus.UNAUTHORIZED)
    }
  }
}
