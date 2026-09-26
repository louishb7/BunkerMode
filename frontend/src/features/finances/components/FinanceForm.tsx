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
export default function FinanceForm({
  kind,
  item = null,
  objectives = [],
  initialObjectiveId = null,
  today,
  busy,
  error,
  onSave,
  onCancel,
}) {
  const reserve = kind === "reserve"
  const [title, setTitle] = useState(item?.titulo ?? "")
  const [value, setValue] = useState(item ? moneyInput(item.valor_centavos) : reserve ? "0,00" : "")
  const [target, setTarget] = useState(item?.alvo_centavos ? moneyInput(item.alvo_centavos) : "")
  const [type, setType] = useState(item?.tipo ?? "despesa")
  const [category, setCategory] = useState(item?.categoria ?? "Outros")
  const [date, setDate] = useState(item?.data?.slice(0, 10) ?? today)
  const [objectiveId, setObjectiveId] = useState(
    String(item?.objetivo_id ?? initialObjectiveId ?? "")
  )
  const [validation, setValidation] = useState("")
  async function submit(event) {
    event.preventDefault()
    const cents = parseMoney(value),
      targetCents = target ? parseMoney(target) : null
    if (
      cents === null ||
      (!reserve && cents === 0) ||
      (reserve && target && (!targetCents || targetCents < 1))
    ) {
      setValidation("Use um valor válido, como 1250,50, sem pontos de milhar.")
      return
    }
    setValidation("")
    await onSave(
      reserve
        ? {
            titulo: title,
            valor_centavos: cents,
            alvo_centavos: targetCents,
            objetivo_id: objectiveId ? Number(objectiveId) : null,
          }
        : { titulo: title, tipo: type, categoria: category, data: date, valor_centavos: cents },
      item?.id
    )
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <p className="m-0 text-sm text-text-secondary">
        {reserve
          ? "Separe uma parte do saldo registrado para uma finalidade. Reservar não é gastar."
          : "Registre dinheiro que já entrou ou saiu. Ajustes corrigem o saldo sem contar como receita ou despesa."}
      </p>
      <label className="form-label">
        {reserve ? "Nome da reserva" : "Descrição"}
        <input
          className="form-field"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {!reserve && (
        <label className="form-label">
          Tipo
          <select
            className="form-field"
            aria-label="Tipo"
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              if (category === "Ajuste") setCategory("Outros")
            }}
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="ajuste_entrada">Saldo inicial / ajuste de entrada</option>
            <option value="ajuste_saida">Ajuste de saída</option>
          </select>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="form-label">
          {reserve ? "Valor reservado (R$)" : "Valor (R$)"}
          <input
            className="form-field"
            required
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0,00"
          />
        </label>
        {reserve ? (
          <label className="form-label">
            Alvo opcional (R$)
            <input
              className="form-field"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Sem alvo"
            />
          </label>
        ) : (
          <label className="form-label">
            Data
            <input
              className="form-field"
              type="date"
              required
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
      </div>
      {!reserve && !type.startsWith("ajuste") && (
        <label className="form-label">
          Categoria
          <select
            className="form-field"
            aria-label="Categoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      {reserve && objectives.length > 0 && (
        <label className="form-label">
          Objetivo opcional
          <select
            className="form-field"
            aria-label="Objetivo opcional"
            value={objectiveId}
            onChange={(e) => setObjectiveId(e.target.value)}
          >
            <option value="">Sem vínculo</option>
            {objectives.map((goal) => (
              <option value={goal.id} key={goal.id}>
                {goal.titulo}
              </option>
            ))}
          </select>
        </label>
      )}
      {(error || validation) && (
        <p role="alert" className="m-0 text-sm text-danger">
          {validation || error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy}>
          Salvar {reserve ? "reserva" : "lançamento"}
        </Button>
      </div>
    </form>
  )
}
