import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import { moneyInput, parseMoney } from "../money"

const categories = [
  "Trabalho",
  "Moradia",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Estudos",
  "Lazer",
  "Outros",
]

export default function FinanceForm({ item = null, today, busy, error, onSave, onCancel }) {
  const legacyAdjustment = item?.tipo?.startsWith("ajuste")
  const [type, setType] = useState(item?.tipo ?? "despesa")
  const [value, setValue] = useState(item ? moneyInput(item.valor_centavos) : "")
  const [title, setTitle] = useState(item?.titulo ?? "")
  const [date, setDate] = useState(item?.data?.slice(0, 10) ?? today)
  const [category, setCategory] = useState(item?.categoria ?? "Outros")
  const [validation, setValidation] = useState("")
  async function submit(event) {
    event.preventDefault()
    const cents = parseMoney(value)
    if (!cents) {
      setValidation("Informe um valor válido, como 1250,50.")
      return
    }
    setValidation("")
    await onSave(
      { titulo: title.trim(), tipo: type, valor_centavos: cents, data: date, categoria: category },
      item?.id
    )
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
            aria-checked={type === "receita"}
            onClick={() => setType("receita")}
          >
            Entrada
          </button>
          <button
            type="button"
            role="radio"
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
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0,00"
        />
      </label>
      <label className="form-label">
        Descrição
        <input
          className="form-field"
          required
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
          type="date"
          max={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {!legacyAdjustment && (
        <details className="finance-more">
          <summary>Mais opções</summary>
          <label className="form-label">
            Categoria
            <select
              className="form-field"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </details>
      )}
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
