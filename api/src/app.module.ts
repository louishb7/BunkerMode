import { OrientationModule } from "./orientation/orientation.module";
import { FinancesModule } from "./finances/finances.module";
import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { GoalsModule } from "./goals/goals.module";
import { HealthController } from "./health.controller";
import { TasksModule } from "./tasks/tasks.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    OrientationModule,
    FinancesModule,
    AuthModule,
    GoalsModule,
    TasksModule,
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
