import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { FinancesService } from "./finances.service";

@Controller("api/v2/financas")
@UseGuards(AuthGuard)
export class FinancesController {
  constructor(private readonly service: FinancesService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  overview(@Req() r: AuthenticatedRequest, @Query("mes") month?: string) {
    return this.service.overview(r.currentUser!, month);
  }
  @Post("lancamentos") createEntry(
    @Req() r: AuthenticatedRequest,
    @Body() p: unknown,
  ) {
    return this.service.createEntry(r.currentUser!, p);
  }
  @Patch("lancamentos/:id") updateEntry(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() p: unknown,
  ) {
    return this.service.updateEntry(r.currentUser!, Number(id), p);
  }
  @Delete("lancamentos/:id") @HttpCode(204) deleteEntry(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.service.deleteEntry(r.currentUser!, Number(id));
  }
  @Post("reservas") createReserve(
    @Req() r: AuthenticatedRequest,
    @Body() p: unknown,
  ) {
    return this.service.saveReserve(r.currentUser!, p);
  }
  @Patch("reservas/:id") updateReserve(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() p: unknown,
  ) {
    return this.service.saveReserve(r.currentUser!, p, Number(id));
  }
  @Delete("reservas/:id") @HttpCode(204) deleteReserve(
    @Req() r: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.service.deleteReserve(r.currentUser!, Number(id));
  }
}
