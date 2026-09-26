import {
  Controller,
  Get,
  Header,
  Module,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { CalendarModule } from "../calendar/calendar.module";
import { PrismaModule } from "../prisma/prisma.module";
import { FinancesModule } from "../finances/finances.module";
import { OrientationService } from "./orientation.service";
@Controller("api/v2/orientacao")
@UseGuards(AuthGuard)
class OrientationController {
  constructor(private readonly service: OrientationService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  read(
    @Req() r: AuthenticatedRequest,
    @Query("incluir_tarefas") includeTasks?: string,
  ) {
    return this.service.read(r.currentUser!, includeTasks !== "false");
  }
}
@Module({
  imports: [AuthModule, CalendarModule, PrismaModule, FinancesModule],
  controllers: [OrientationController],
  providers: [OrientationService],
})
export class OrientationModule {}
