import React from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Focus, Plus } from "lucide-react"

import Button from "../../../components/ui/Button"
import DaySelector from "../../calendar/components/DaySelector"

export default function WeekPanel({
  onCreateTask,
  onStartFocus,
  onNextWeek,
  onToday,
  onPreviousWeek,
  onSelectDate,
  selectedDate,
  todayDate,
  weekLabel,
  weekDays,
}) {
  const currentWeek = weekDays.some((date) => date.getTime() === todayDate.getTime())
  return (
    <section className="grid gap-2 p-2 sm:px-4" aria-label="Calendário semanal">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="sr-only">
          Tarefas de{" "}
          {selectedDate.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
          })}
        </h2>
        <div className="grid min-w-0 flex-[1_1_250px] grid-cols-[44px_minmax(0,1fr)_44px] items-center sm:max-w-[320px]">
          <Button
            aria-label="Semana anterior"
            className="px-0 text-base"
            variant="ghost"
            onClick={onPreviousWeek}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 items-center justify-center gap-1">
            <p className="m-0 flex items-center gap-1.5 whitespace-nowrap text-xs text-text-secondary sm:text-sm">
              <CalendarDays size={15} aria-hidden="true" />
              {weekLabel}
            </p>
            {!currentWeek && onToday && (
              <Button size="small" variant="ghost" onClick={onToday}>
                Hoje
              </Button>
            )}
          </div>
          <Button
            aria-label="Próxima semana"
            className="px-0 text-base"
            variant="ghost"
            onClick={onNextWeek}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </Button>
        </div>
        <div
          role="group"
          aria-label="Ações do dia selecionado"
          className="ml-auto flex shrink-0 items-center gap-2"
        >
          <Button variant="secondary" onClick={onStartFocus}>
            <Focus size={17} aria-hidden="true" />
            Foco
          </Button>
          <Button onClick={onCreateTask}>
            <Plus size={17} aria-hidden="true" />
            Nova tarefa
          </Button>
        </div>
      </header>
      <DaySelector
        onSelectDate={onSelectDate}
        selectedDate={selectedDate}
        todayDate={todayDate}
        weekDays={weekDays}
      />
    </section>
  )
}
