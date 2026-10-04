import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { GoalsService } from "./goals.service";

@Controller("api/v2")
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get("objetivos")
  list(@Req() request: AuthenticatedRequest) {
    return this.goalsService.list(request.currentUser!);
  }

  @Post("objetivos")
  create(@Req() request: AuthenticatedRequest, @Body() payload: unknown) {
    return this.goalsService.create(request.currentUser!, payload ?? {});
  }

  @Get("objetivos/conquistas")
  achievements(@Req() request: AuthenticatedRequest) {
    return this.goalsService.listAchievements(request.currentUser!);
  }

  @Post("objetivos/:objetivoId/conquistar")
  conquer(
    @Req() request: AuthenticatedRequest,
    @Param("objetivoId") objetivoId: string,
    @Body() payload: { nota?: unknown },
  ) {
    return this.goalsService.conquer(
      request.currentUser!,
      Number(objetivoId),
      payload ?? {},
    );
  }

  @Patch("objetivos/ordem")
  reorder(@Req() request: AuthenticatedRequest, @Body() payload: unknown) {
    return this.goalsService.reorder(request.currentUser!, payload ?? {});
  }

  @Patch("objetivos/:objetivoId")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("objetivoId") objetivoId: string,
    @Body() payload: unknown,
  ) {
    return this.goalsService.update(
      request.currentUser!,
      Number(objetivoId),
      payload ?? {},
    );
  }

  @Patch("objetivos/:objetivoId/status")
  updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param("objetivoId") objetivoId: string,
    @Body() payload: { status?: unknown },
  ) {
    return this.goalsService.updateStatus(
      request.currentUser!,
      Number(objetivoId),
      payload?.status,
    );
  }

  @Delete("objetivos/:objetivoId")
  @HttpCode(204)
  delete(
    @Req() request: AuthenticatedRequest,
    @Param("objetivoId") objetivoId: string,
  ) {
    return this.goalsService.delete(request.currentUser!, Number(objetivoId));
  }
}
