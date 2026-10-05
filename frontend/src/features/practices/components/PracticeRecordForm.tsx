import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import type { Tracker } from "../../../types/trackerContract"
import {
  addPracticeDays,
  planOn,
  practiceDate,
  practiceInstant,
  practiceLocalTime,
  practicePlanSignature,
} from "../practiceDomain"
import { formatPracticeLocalDateTime } from "../dateTime"

const fieldClass =
  "min-h-11 w-full rounded-control border border-control-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"

export default function PracticeRecordForm({
  tracker,
  onSubmit,
  onCancel,
  loading = false,
  timezone = "America/Recife",
}: {
  tracker: Tracker
  onSubmit: (payload: Record<string, unknown>) => unknown
  onCancel: () => void
  loading?: boolean
  timezone?: string
}) {
  const zone = tracker.planos?.[0]?.timezone ?? timezone
  const [initialTime] = useState(() => new Date())
  const [when, setWhen] = useState(() => practiceLocalTime(initialTime, zone))
  const [kind, setKind] = useState(tracker.intent === "repetir" ? "atividade" : "ocorrencia")
  const [amount, setAmount] = useState("")
  const [withAmount, setWithAmount] = useState(false)
  const [unit, setUnit] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const plan = planOn(tracker.planos ?? [], when.slice(0, 10))
  const free = !tracker.intent || tracker.intent === "registro_livre"
  const quantitative = (free ? withAmount : plan?.target_amount != null) && kind !== "confirmacao"
  const canConfirm = tracker.intent === "reduzir" || tracker.intent === "evitar"

  function changeKind(value: string) {
    setKind(value)
    if (value === "confirmacao") {
      const previous = addPracticeDays(practiceDate(initialTime, zone), -1)
      const day =
        plan?.frequency === "semanal"
          ? addPracticeDays(previous, -new Date(`${previous}T12:00:00Z`).getUTCDay())
          : previous
      setWhen(`${day}T12:00`)
    } else setWhen(practiceLocalTime(initialTime, zone))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    try {
      const occurred =
        when === practiceLocalTime(initialTime, zone)
          ? initialTime.toISOString()
          : practiceInstant(when, zone)
      if (Date.parse(occurred) > Date.now()) throw new Error("Escolha um momento que já aconteceu.")
      if (tracker.intent && tracker.intent !== "registro_livre" && !plan)
        throw new Error("Escolha uma data a partir do início deste comportamento.")
      if (kind === "confirmacao") {
        const day = when.slice(0, 10)
        const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
        const end = plan?.frequency === "semanal" ? addPracticeDays(day, 6 - weekday) : day
        if (end >= practiceDate(new Date(), zone))
          throw new Error("Confirme somente um período já encerrado e observado por inteiro.")
      }
      const quantity = quantitative ? Number(amount.replace(",", ".")) : null
      if (
        quantitative &&
        (!Number.isFinite(quantity) ||
          quantity <= 0 ||
          quantity > 1e9 ||
          Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001)
      )
        throw new Error("Informe uma quantidade positiva, com até três casas decimais.")
      onSubmit({
        occurred_at: occurred,
        kind,
        ...(plan
          ? {
              plan_effective_from: plan.effective_from,
              unit: plan.unit ?? null,
              plan_signature: practicePlanSignature(plan),
            }
          : {}),
        ...(quantitative
          ? { amount: quantity, ...(free ? { unit: unit.trim() || null } : {}) }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : "Confira o registro.")
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="m-0 text-sm text-text-secondary">{tracker.titulo}</p>
      {canConfirm && (
        <label className="grid gap-2 text-sm">
          Tipo de registro
          <select
            name="kind"
            className={fieldClass}
            value={kind}
            onChange={(event) => changeKind(event.target.value)}
          >
            <option value="ocorrencia">Registrar ocorrência</option>
            <option value="confirmacao">Confirmar período observado</option>
          </select>
        </label>
      )}
      <label className="grid gap-2 text-sm">
        {kind === "confirmacao" ? "Dia do período observado" : "Quando aconteceu?"}
        <div
          className={`${fieldClass} relative flex items-center focus-within:outline-2 focus-within:outline-focus-ring`}
        >
          <span aria-hidden="true" className="relative z-0 text-sm text-text-primary">
            {formatPracticeLocalDateTime(when)}
          </span>
          <input
            name="occurred_at"
            type="datetime-local"
            lang="pt-BR"
            aria-label={`Quando aconteceu? ${formatPracticeLocalDateTime(when)}`}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 focus:outline-none"
            required
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </div>
      </label>
      <p className="m-0 text-xs text-text-secondary">
        Calendário: {zone}.{" "}
        {kind === "confirmacao"
          ? "Confirme apenas se observou todo o dia ou semana. Dias sem informação continuam desconhecidos."
          : "Formato exibido: dia/mês/ano, 24 horas. A data do evento permanece no histórico, mesmo ao sincronizar depois."}
      </p>
      {free && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withAmount}
            onChange={(event) => setWithAmount(event.target.checked)}
          />{" "}
          Incluir quantidade ou duração
        </label>
      )}
      {quantitative && (
        <label className="grid gap-2 text-sm">
          Quantidade{!free ? ` · ${plan.unit ?? "unidades"}` : ""}
          <input
            name="amount"
            className={fieldClass}
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Ex.: 20"
          />
          <span className="text-xs text-text-secondary">
            {free
              ? "O registro permanece uma observação, sem meta ou conclusão automática."
              : "Você pode registrar outra parte depois. Os registros são somados no período."}
          </span>
        </label>
      )}
      {free && quantitative && (
        <label className="grid gap-2 text-sm">
          Unidade (opcional)
          <input
            name="unit"
            className={fieldClass}
            maxLength={40}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="copos, minutos, unidades"
          />
        </label>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer text-sm">Observação opcional</summary>
        <textarea
          name="note"
          className={`${fieldClass} min-h-20`}
          maxLength={2000}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </details>
      {error && (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={loading} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={loading}>
          {kind === "confirmacao" ? "Confirmar observação" : "Salvar registro"}
        </Button>
      </div>
    </form>
  )
}
