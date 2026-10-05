import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import type { Tracker } from "../../../types/trackerContract"
import { addPracticeDays, practiceDate } from "../practiceDomain"

export default function PracticePauseForm({
  tracker,
  timezone,
  onSubmit,
  onCancel,
}: {
  tracker: Tracker
  timezone?: string
  onSubmit: (payload: Record<string, unknown>) => unknown
  onCancel: () => void
}) {
  const last = tracker.planos?.at(-1)
  const today = practiceDate(new Date(), last?.timezone ?? timezone)
  const hasHistory = tracker.ocorrencias.some(
    (record) => practiceDate(record.occurred_at, last?.timezone ?? timezone) >= today
  )
  const first =
    last?.effective_from > today
      ? addPracticeDays(last.effective_from, 1)
      : hasHistory
        ? addPracticeDays(today, 1)
        : today
  const [from, setFrom] = useState(first)
  const resume = tracker.status === "pausado"
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          status: resume ? "ativo" : "pausado",
          ...(last ? { effective_from: from } : {}),
        })
      }}
    >
      {last && (
        <label className="grid gap-2 text-sm">
          A partir de
          <input
            className="min-h-11 rounded-control border border-control-border bg-surface px-3"
            name="effective_from"
            type="date"
            required
            min={first}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
      )}
      <p className="m-0 text-sm text-text-secondary">
        A pausa exclui oportunidades do período. Registros e metas anteriores permanecem no
        histórico. Um dia que já possui registros mantém seu plano.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">{resume ? "Retomar" : "Pausar"}</Button>
      </div>
    </form>
  )
}
