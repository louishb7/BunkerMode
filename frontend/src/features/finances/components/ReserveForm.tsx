import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import { moneyInput, parseMoney } from "../money"

export default function ReserveForm({ item = null, goals = [], busy, error, onSave, onCancel }) {
  const [title, setTitle] = useState(item?.titulo ?? "")
  const [amount, setAmount] = useState(item ? moneyInput(item.valor_centavos) : "")
  const [target, setTarget] = useState(item?.alvo_centavos ? moneyInput(item.alvo_centavos) : "")
  const [goal, setGoal] = useState(item?.objetivo_id == null ? "" : String(item.objetivo_id))
  const [validation, setValidation] = useState("")
  async function submit(event) {
    event.preventDefault()
    const cents = parseMoney(amount)
    const targetCents = target.trim() ? parseMoney(target) : null
    if (cents === null || (target.trim() && (!targetCents || targetCents < 1))) {
      setValidation("Informe valores válidos em reais e centavos.")
      return
    }
    setValidation("")
    await onSave(
      {
        titulo: title.trim(),
        valor_centavos: cents,
        alvo_centavos: targetCents,
        objetivo_id: goal ? (goal.startsWith("local:") ? goal : Number(goal)) : null,
      },
      item?.id
    )
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="form-label">
        Nome da reserva
        <input
          className="form-field"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="form-label">
        Valor reservado (R$)
        <input
          className="form-field"
          required
          inputMode="decimal"
          placeholder="0,00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="form-label">
        Alvo opcional (R$)
        <input
          className="form-field"
          inputMode="decimal"
          placeholder="0,00"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <label className="form-label">
        Objetivo opcional
        <select
          className="form-field"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        >
          <option value="">Sem objetivo</option>
          {goals.map((item) => (
            <option key={item.id} value={item.id}>
              {item.titulo}
            </option>
          ))}
        </select>
      </label>
      {(validation || error) && (
        <p role="alert" className="text-sm text-danger">
          {validation || error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy}>
          Salvar reserva
        </Button>
      </div>
    </form>
  )
}
