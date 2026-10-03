import React, { useState } from "react"
import type {
  FinanceEntry,
  FinanceEntryPayload,
  FinanceEntryType,
} from "../../../types/financeContract"
import Button from "../../../components/ui/Button"
import { formatMoneyInput, moneyInput, parseMoney } from "../money"

type FinanceFormProps = {
  item?: FinanceEntry | null
  today: string
  busy: boolean
  error: string
  onSave: (payload: FinanceEntryPayload, id?: number | string) => Promise<unknown>
  onCancel: () => void
}

export default function FinanceForm({
  item = null,
  today,
  busy,
  error,
  onSave,
  onCancel,
}: FinanceFormProps) {
  const legacyAdjustment = item?.tipo?.startsWith("ajuste")
  const [type, setType] = useState<FinanceEntryType>(item?.tipo ?? "despesa")
  const [value, setValue] = useState(item ? moneyInput(item.valor_centavos) : "")
  const [title, setTitle] = useState(item?.titulo ?? "")
  const [date, setDate] = useState(item?.data?.slice(0, 10) ?? today)
  const [validation, setValidation] = useState("")
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!title.trim()) {
      setValidation("Informe a descrição do movimento.")
      return
    }
    const cents = parseMoney(value)
    if (!cents) {
      setValidation("Informe um valor entre R$ 0,01 e R$ 21.474.836,47.")
      return
    }
    setValidation("")
    await onSave({ titulo: title.trim(), tipo: type, valor_centavos: cents, data: date }, item?.id)
  }
  return (
    <form onSubmit={submit} className="finance-form">
      {legacyAdjustment ? (
        <p className="text-sm text-text-secondary">Este movimento é um ajuste de saldo anterior.</p>
      ) : (
        <div className="finance-type" role="radiogroup" aria-label="Tipo de movimento">
          <button
            type="button"
            role="radio"
            disabled={busy}
            aria-checked={type === "receita"}
            onClick={() => setType("receita")}
          >
            Entrada
          </button>
          <button
            type="button"
            role="radio"
            disabled={busy}
            aria-checked={type === "despesa"}
            onClick={() => setType("despesa")}
          >
            Saída
          </button>
        </div>
      )}
      <label className="form-label">
        Valor (R$)
        <input
          className="form-field"
          required
          autoFocus
          name="valor"
          disabled={busy}
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(formatMoneyInput(event.target.value))}
          placeholder="0,00"
          aria-describedby="finance-value-helper"
        />
        <small id="finance-value-helper" className="text-text-secondary">
          Digite os centavos: 1 = 0,01; 1250 = 12,50.
        </small>
      </label>
      <label className="form-label">
        Descrição
        <input
          className="form-field"
          required
          name="descricao"
          disabled={busy}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Do que se trata?"
        />
      </label>
      <label className="form-label">
        Data
        <input
          className="form-field"
          required
          name="data"
          disabled={busy}
          type="date"
          max={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {(validation || error) && (
        <p role="alert" className="text-sm text-danger">
          {validation || error}
        </p>
      )}
      <div className="finance-form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy}>
          Salvar movimento
        </Button>
      </div>
    </form>
  )
}
