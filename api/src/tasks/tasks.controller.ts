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

import { AuthenticatedRequest } from "../auth/auth.types";
import { AuthGuard } from "../auth/auth.guard";
import { TasksService } from "./tasks.service";
import { toTaskHistoryEventResponse, toTaskResponse } from "./task-response";

function taskId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    return 0;
  }
  return id;
}

@Controller("api/v2")
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get("tarefas")
  async listTasks(@Req() request: AuthenticatedRequest) {
    const user = request.currentUser!;
    const tasks = await this.tasksService.listForTasksBoard(user);
    return tasks.map((task) => toTaskResponse(task, user));
  }

  @Post("tarefas")
  async createTask(
    @Req() request: AuthenticatedRequest,
    @Body() payload: unknown,
  ) {
    const user = request.currentUser!;
    const task = await this.tasksService.create(payload ?? {}, user);
    return toTaskResponse(task, user);
  }

  @Post("tarefas/recorrencias/materializar")
  @HttpCode(204)
  async materializeRecurrences(@Req() request: AuthenticatedRequest) {
    await this.tasksService.materializeRecurrences(request.currentUser!);
  }

  @Get("tarefas/dia-operacional")
  async listDailyTasks(@Req() request: AuthenticatedRequest) {
    const user = request.currentUser!;
    const tasks = await this.tasksService.listDailyOperational(user);
    return tasks.map((task) => toTaskResponse(task, user));
  }

  @Get("tarefas/foco")
  async focusBoard(@Req() request: AuthenticatedRequest) {
    const user = request.currentUser!;
    const board = await this.tasksService.focusBoard(user);
    return {
      tasks: board.action_tasks.map((task) => toTaskResponse(task, user)),
      daily_tasks: board.daily_tasks.map((task) => toTaskResponse(task, user)),
    };
  }

  @Get("tarefas/historico")
  async listHistoricalTasks(@Req() request: AuthenticatedRequest) {
    const user = request.currentUser!;
    const tasks = await this.tasksService.listHistorical(user);
    return tasks.map((task) => toTaskResponse(task, user));
  }

  @Patch("tarefas/:id")
  async updateTask(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() payload: unknown,
  ) {
    const user = request.currentUser!;
    const task = await this.tasksService.update(
      taskId(id),
      payload ?? {},
      user,
    );
    return toTaskResponse(task, user);
  }

  @Patch("tarefas/:id/concluir")
  async completeTask(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const user = request.currentUser!;
    const task = await this.tasksService.complete(taskId(id), user);
    return toTaskResponse(task, user);
  }

  @Post("tarefas/:id/vincular-objetivo")
  linkToObjective(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() payload: { objetivo_id?: unknown },
  ) {
    return this.tasksService.linkToObjective(
      taskId(id),
      request.currentUser!,
      payload?.objetivo_id,
    );
  }

  @Post("tarefas/:id/desvincular-objetivo")
  unlinkFromObjective(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.tasksService.unlinkFromObjective(
      taskId(id),
      request.currentUser!,
    );
  }

  @Patch("tarefas/:id/toggle-pin")
  async togglePin(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const user = request.currentUser!;
    const task = await this.tasksService.togglePin(taskId(id), user);
    return toTaskResponse(task, user);
  }

  @Post("tarefas/:id/reabrir")
  @HttpCode(200)
  async reopenTask(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const user = request.currentUser!;
    return toTaskResponse(
      await this.tasksService.reopen(taskId(id), user),
      user,
    );
  }

  @Delete("tarefas/:id")
  @HttpCode(204)
  async deleteTask(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    await this.tasksService.delete(taskId(id), request.currentUser!);
  }

  @Get("tarefas/:id/historico")
  async taskHistory(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const events = await this.tasksService.taskHistory(
      taskId(id),
      request.currentUser!,
    );
    return events.map(toTaskHistoryEventResponse);
  }
}
