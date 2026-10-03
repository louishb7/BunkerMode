import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TasksModule } from "../tasks/tasks.module";
import { GoalsModule } from "../goals/goals.module";
import { FinancesModule } from "../finances/finances.module";
import { OfflineController } from "./offline.controller";
import { OfflineService } from "./offline.service";

@Module({
  imports: [AuthModule, PrismaModule, TasksModule, GoalsModule, FinancesModule],
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
