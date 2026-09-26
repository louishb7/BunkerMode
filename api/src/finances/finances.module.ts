import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CalendarModule } from "../calendar/calendar.module";
import { PrismaModule } from "../prisma/prisma.module";
import { FinancesController } from "./finances.controller";
import { FinancesService } from "./finances.service";
@Module({
  imports: [AuthModule, CalendarModule, PrismaModule],
  controllers: [FinancesController],
  providers: [FinancesService],
  exports: [FinancesService],
})
export class FinancesModule {}
