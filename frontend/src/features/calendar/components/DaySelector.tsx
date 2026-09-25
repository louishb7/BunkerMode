import React from "react"

import { formatDateForApi } from "../../../utils/date"

const WEEK_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

export default function DaySelector({ onSelectDate, selectedDate, todayDate, weekDays }) {
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5" aria-label="Dias da semana">
      {weekDays.map((date) => {
        const apiDate = formatDateForApi(date)
        const selected = date.getTime() === selectedDate.getTime()
        const today = date.getTime() === todayDate.getTime()
        return (
          <button
            key={apiDate}
            aria-pressed={selected}
            aria-current={today ? "date" : undefined}
            aria-label={date.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            className={`relative grid min-h-16 min-w-0 content-center justify-items-center rounded-control border px-0 text-sm font-medium transition-[background-color,border-color,transform] active:scale-[0.97] motion-reduce:transition-none motion-reduce:transform-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${selected ? "border-selection-border bg-selection text-selection-text ring-1 ring-inset ring-selection-border" : today ? "border-border bg-peripheral text-text-primary hover:border-border-strong" : "border-border bg-surface-subtle text-text-primary hover:border-border-strong hover:bg-peripheral"}`}
            type="button"
            onClick={() => onSelectDate(date)}
          >
            <span className="text-xs text-text-secondary">{WEEK_LABELS[date.getDay()]}</span>
            <span className="text-lg font-semibold leading-5">
              {String(date.getDate()).padStart(2, "0")}
            </span>
            <span
              className={`min-h-4 text-[10px] font-semibold uppercase leading-4 ${today ? "text-accent underline decoration-2 underline-offset-2" : "invisible"}`}
              aria-hidden={!today}
            >
              Hoje
            </span>
          </button>
        )
      })}
    </div>
  )
}
