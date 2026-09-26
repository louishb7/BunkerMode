import React from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import Button from "../../../components/ui/Button"
import DaySelector from "../../calendar/components/DaySelector"

export default function WeekPanel({
  onNextWeek,
  onToday,
  onPreviousWeek,
  onSelectDate,
  selectedDate,
  todayDate,
  weekLabel,
  weekDays,
}) {
  return (
    <section
      className="mx-auto grid w-full max-w-[780px] gap-2 py-3 sm:py-4"
      aria-label="Calendário semanal"
    >
      <header className="relative grid grid-cols-[44px_minmax(0,1fr)_44px] items-center">
        <h2 className="sr-only">
          Tarefas de{" "}
          {selectedDate.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
          })}
        </h2>
        <Button aria-label="Semana anterior" size="icon" variant="ghost" onClick={onPreviousWeek}>
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2">
          <p className="m-0 flex items-center gap-2 text-xs text-text-secondary sm:text-sm">
            <CalendarDays size={16} aria-hidden="true" />
            {weekLabel}
          </p>
          {onToday && (
            <Button size="small" variant="ghost" onClick={onToday}>
              Hoje
            </Button>
          )}
        </div>
        <Button aria-label="Próxima semana" size="icon" variant="ghost" onClick={onNextWeek}>
          <ChevronRight size={20} aria-hidden="true" />
        </Button>
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
