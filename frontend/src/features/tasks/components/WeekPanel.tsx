import React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

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
  const currentWeek = weekDays.some((date) => date.getTime() === todayDate.getTime())
  return (
    <section
      className="grid gap-1 border-b border-border p-2 sm:px-4"
      aria-label="Calendário semanal"
    >
      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
        <Button
          aria-label="Semana anterior"
          className="px-0 text-base"
          variant="ghost"
          onClick={onPreviousWeek}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 items-center justify-center gap-1">
          <p className="m-0 text-sm text-text-secondary">{weekLabel}</p>
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
      <DaySelector
        onSelectDate={onSelectDate}
        selectedDate={selectedDate}
        todayDate={todayDate}
        weekDays={weekDays}
      />
    </section>
  )
}
