import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import { addPracticeDays, practiceDate } from "../../practices/practiceDomain"
const fieldClass =
  "min-h-11 w-full rounded-control border border-control-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
export default function TrackerForm({
  tracker = null,
  objetivoTitulo = "",
  loading = false,
  onCancel,
  onSubmit,
  onDirty = undefined,
  timezone = "America/Recife",
  objectiveOptions = [],
  lockObjetivo = false,
}) {
  const last = tracker?.planos?.at(-1)
  const today = practiceDate(new Date(), last?.timezone ?? timezone)
  const [titulo, setTitulo] = useState(tracker?.titulo ?? "")
  const [descricao, setDescricao] = useState(tracker?.descricao ?? "")
  const [intent, setIntent] = useState(tracker?.intent ?? (tracker ? "registro_livre" : "repetir"))
  const [frequency, setFrequency] = useState(last?.frequency ?? "diaria")
  const [quantitative, setQuantitative] = useState(last?.target_amount != null)
  const [target, setTarget] = useState(
    last?.target_amount == null ? "" : String(last.target_amount)
  )
  const [unit, setUnit] = useState(last?.unit ?? "")
  const [times, setTimes] = useState(String(last?.times_per_week ?? 3))
  const [weekdays, setWeekdays] = useState<number[]>(last?.weekdays ?? [0, 2, 4])
  const [from, setFrom] = useState(
    tracker ? addPracticeDays(last?.effective_from > today ? last.effective_from : today, 1) : today
  )
  const [error, setError] = useState("")
  const [objectiveId, setObjectiveId] = useState(String(tracker?.objetivo_id ?? ""))
  const [dateChanged, setDateChanged] = useState(false)
  function submit(event) {
    event.preventDefault()
    setError("")
    if (!titulo.trim()) return
    const hasAmount = intent === "reduzir" || (intent === "repetir" && quantitative)
    const amount = hasAmount ? Number(target.replace(",", ".")) : null
    if (
      hasAmount &&
      (!Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1e9 ||
        Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.00001)
    ) {
      setError("Informe uma quantidade positiva, com até três casas decimais.")
      return
    }
    if (frequency === "dias_fixos" && !weekdays.length) {
      setError("Escolha ao menos um dia da semana.")
      return
    }
    const plan =
      intent === "registro_livre"
        ? null
        : {
            effective_from: from,
            frequency,
            weekdays: frequency === "dias_fixos" ? weekdays : [],
            target_amount: amount,
            unit: hasAmount ? unit.trim() || null : null,
            times_per_week: frequency === "semanal" && !hasAmount ? Number(times) : null,
            timezone: last?.timezone ?? timezone,
          }
    if (
      plan?.frequency === "semanal" &&
      plan.times_per_week != null &&
      (!Number.isInteger(plan.times_per_week) ||
        plan.times_per_week < 1 ||
        plan.times_per_week > 100)
    ) {
      setError("Informe de 1 a 100 vezes por semana.")
      return
    }
    const changed =
      plan &&
      (!last ||
        dateChanged ||
        plan.frequency !== last.frequency ||
        plan.target_amount !== (last.target_amount ?? null) ||
        plan.unit !== (last.unit ?? null) ||
        plan.times_per_week !== (last.times_per_week ?? null) ||
        JSON.stringify(plan.weekdays) !== JSON.stringify(last.weekdays ?? []))
    onSubmit({
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      ...(!tracker ? { intent } : {}),
      ...(!lockObjetivo
        ? {
            objetivo_id: objectiveId
              ? objectiveId.startsWith("local:")
                ? objectiveId
                : Number(objectiveId)
              : null,
          }
        : {}),
      ...(plan && (!tracker || changed) ? { plan } : {}),
    })
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      {lockObjetivo && objetivoTitulo && (
        <p className="m-0 text-sm text-text-secondary">Objetivo: {objetivoTitulo}</p>
      )}
      <label className="grid gap-2 text-sm font-medium">
        Título
        <input
          name="titulo"
          className={fieldClass}
          maxLength={200}
          required
          value={titulo}
          onChange={(event) => setTitulo(event.target.value)}
          placeholder="Ex.: Ler, treinar ou observar distrações"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        O que você quer acompanhar?
        <select
          name="intent"
          className={fieldClass}
          disabled={Boolean(tracker)}
          value={intent}
          onChange={(event) => {
            const value = event.target.value
            setIntent(value)
            if (value !== "repetir" && frequency === "semanal") setFrequency("diaria")
          }}
        >
          <option value="repetir">Repetir um comportamento</option>
          <option value="reduzir">Reduzir quantidade</option>
          <option value="evitar">Evitar um comportamento</option>
          <option value="registro_livre">Só registrar quando acontece</option>
        </select>
      </label>
      {intent !== "registro_livre" && (
        <>
          {intent === "repetir" && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={quantitative}
                onChange={(event) => setQuantitative(event.target.checked)}
              />{" "}
              Definir uma quantidade
            </label>
          )}
          {(intent === "reduzir" || (intent === "repetir" && quantitative)) && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm">
                {intent === "reduzir" ? "Limite escolhido" : "Meta"}
                <input
                  name="target_amount"
                  className={fieldClass}
                  inputMode="decimal"
                  required
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="30"
                />
              </label>
              <label className="grid gap-2 text-sm">
                Unidade
                <input
                  name="unit"
                  className={fieldClass}
                  maxLength={40}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="páginas, copos, minutos"
                />
              </label>
            </div>
          )}
          <label className="grid gap-2 text-sm">
            Frequência
            <select
              name="frequency"
              className={fieldClass}
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
            >
              <option value="diaria">Todos os dias</option>
              <option value="dias_fixos">Dias específicos</option>
              {intent !== "evitar" && <option value="semanal">Meta semanal flexível</option>}
            </select>
          </label>
          {frequency === "dias_fixos" && (
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-sm">Dias da semana</legend>
              <div className="flex flex-wrap gap-2">
                {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label, day) => (
                  <button
                    type="button"
                    className="min-h-11 min-w-11 rounded-control border border-border px-2 text-sm aria-pressed:bg-selection aria-pressed:text-selection-text"
                    key={day}
                    aria-pressed={weekdays.includes(day)}
                    onClick={() => {
                      setWeekdays((current) =>
                        current.includes(day)
                          ? current.filter((item) => item !== day)
                          : [...current, day].sort()
                      )
                      onDirty?.()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {frequency === "semanal" && intent === "repetir" && !quantitative && (
            <label className="grid gap-2 text-sm">
              Vezes por semana
              <input
                name="times_per_week"
                className={fieldClass}
                type="number"
                min="1"
                max="100"
                required
                value={times}
                onChange={(event) => setTimes(event.target.value)}
              />
            </label>
          )}
          {frequency === "semanal" && (
            <p className="m-0 text-xs text-text-secondary">
              {quantitative || intent === "reduzir"
                ? "A quantidade é o total escolhido para a semana."
                : "Os registros podem acontecer em quaisquer dias. Não são dias fixos."}
            </p>
          )}
          <label className="grid gap-2 text-sm">
            {tracker ? "Nova meta a partir de" : "Começar"}
            <input
              name="effective_from"
              type="date"
              className={fieldClass}
              required
              min={today}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
                setDateChanged(true)
              }}
            />
          </label>
          {tracker && (
            <p className="m-0 text-xs text-text-secondary">
              O plano anterior e seus registros permanecem no histórico.
            </p>
          )}
        </>
      )}
      {!lockObjetivo && (
        <label className="grid gap-2 text-sm">
          Objetivo (opcional)
          <select
            name="objetivo_id"
            className={fieldClass}
            value={objectiveId}
            onChange={(event) => setObjectiveId(event.target.value)}
          >
            <option value="">Nenhum</option>
            {tracker?.objetivo_id != null &&
              !objectiveOptions.some((goal) => String(goal.id) === String(tracker.objetivo_id)) && (
                <option value={String(tracker.objetivo_id)}>
                  {objetivoTitulo || "Objetivo vinculado"}
                </option>
              )}
            {objectiveOptions.map((goal) => (
              <option key={goal.id} value={String(goal.id)}>
                {goal.titulo}
              </option>
            ))}
          </select>
        </label>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer text-sm">Descrição opcional</summary>
        <textarea
          className={`${fieldClass} min-h-20 resize-y`}
          rows={3}
          value={descricao}
          onChange={(event) => setDescricao(event.target.value)}
        />
      </details>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={loading} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={loading}>
          {tracker ? "Salvar" : "Adicionar comportamento"}
        </Button>
      </div>
    </form>
  )
}
