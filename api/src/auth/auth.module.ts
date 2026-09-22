import { Module } from "@nestjs/common"

import { PrismaModule } from "../prisma/prisma.module"
import { AuthController } from "./auth.controller"
import { AuthGuard } from "./auth.guard"
import { AuthRateLimitService } from "./rate-limit.service"
import { AuthService } from "./auth.service"
import { TokenService } from "./token.service"
import { EmailService, ResendEmailService } from "./email.service"
import { PasswordResetService } from "./password-reset.service"

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthGuard, AuthRateLimitService, AuthService, TokenService, PasswordResetService,
    { provide: EmailService, useClass: ResendEmailService }],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
