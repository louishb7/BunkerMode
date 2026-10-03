import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { OfflineService } from "./offline.service";

@Controller("api/v2/offline/operations")
@UseGuards(AuthGuard)
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Post()
  execute(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.offline.execute(request.currentUser!, body);
  }
}
