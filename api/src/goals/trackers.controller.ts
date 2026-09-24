import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { TrackersService } from "./trackers.service";

@Controller("api/v2/acompanhamentos")
@UseGuards(AuthGuard)
export class TrackersController {
  constructor(private readonly service: TrackersService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(request.currentUser!);
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() payload: unknown) {
    return this.service.create(request.currentUser!, payload ?? {});
  }

  @Patch(":id")
  update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() payload: unknown) {
    return this.service.update(request.currentUser!, Number(id), payload ?? {});
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.delete(request.currentUser!, Number(id));
  }

  @Post(":id/ocorrencias")
  recordOccurrence(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.recordOccurrence(request.currentUser!, Number(id));
  }

  @Delete(":id/ocorrencias/:occurrenceId")
  @HttpCode(204)
  deleteOccurrence(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("occurrenceId") occurrenceId: string,
  ) {
    return this.service.deleteOccurrence(request.currentUser!, Number(id), Number(occurrenceId));
  }
}
