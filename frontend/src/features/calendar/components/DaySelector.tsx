import React from "react"

import { formatDateForApi } from "../../../utils/date"

const WEEK_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

export default function DaySelector({ onSelectDate, selectedDate, todayDate, weekDays }) {
  return (
    <div className="calendar-strip" aria-label="Dias da semana">
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
            className="calendar-day"
            type="button"
            onClick={() => onSelectDate(date)}
          >
            <span className="text-xs text-text-secondary">{WEEK_LABELS[date.getDay()]}</span>
            <span className="text-lg font-semibold leading-5">
              {String(date.getDate()).padStart(2, "0")}
            </span>
          </button>
        )
      })}
    </div>
  )
}
