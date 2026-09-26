import React from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

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
    <section className="week-rail" aria-label="Calendário semanal">
      <header className="week-rail-heading">
        <h2 className="sr-only">
          Tarefas de{" "}
          {selectedDate.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
          })}
        </h2>
        <button
          type="button"
          className="week-arrow"
          aria-label="Semana anterior"
          onClick={onPreviousWeek}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className="week-period">
          <p>
            <CalendarDays size={16} aria-hidden="true" />
            {weekLabel}
          </p>
        </div>
        <button
          type="button"
          className="week-arrow"
          aria-label="Próxima semana"
          onClick={onNextWeek}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </header>
      <DaySelector
        onSelectDate={onSelectDate}
        selectedDate={selectedDate}
        todayDate={todayDate}
        weekDays={weekDays}
      />
      {onToday && selectedDate.toDateString() !== todayDate.toDateString() && (
        <button type="button" className="week-today" onClick={onToday}>
          Voltar para hoje
        </button>
      )}
    </section>
  )
}
