import { Module } from "@nestjs/common"

import { AuthModule } from "../auth/auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { GoalsController } from "./goals.controller"
import { GoalsService } from "./goals.service"
import { TrackersController } from "./trackers.controller"
import { TrackersService } from "./trackers.service"

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [GoalsController, TrackersController],
  providers: [GoalsService, TrackersService],
  exports: [GoalsService],
})
export class GoalsModule {}
