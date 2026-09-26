import React, { useEffect, useState } from "react"

import Button from "../../../components/ui/Button"

const emptyForm = {
  titulo: "",
  descricao: "",
  data_alvo: "",
  sem_prazo: true,
}

const fieldClass =
  "min-h-11 w-full rounded-control border border-control-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-app disabled:text-text-secondary disabled:opacity-70"
const labelClass = "grid gap-2 text-sm font-medium normal-case text-text-primary"

export default function ObjetivoForm({ editingObjetivo = null, loading, onCancel, onSubmit }) {
  const [form, setForm] = useState(emptyForm)
  const isEditing = Boolean(editingObjetivo)

  useEffect(() => {
    if (!editingObjetivo) {
      setForm(emptyForm)
      return
    }

    setForm({
      titulo: editingObjetivo.titulo || "",
      descricao: editingObjetivo.descricao || "",
      data_alvo: editingObjetivo.data_alvo || "",
      sem_prazo: !editingObjetivo.data_alvo,
    })
  }, [editingObjetivo])

  function updateField(event) {
    const { checked, name, type, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  function submit(event) {
    event.preventDefault()
    onSubmit?.({
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim() || null,
      data_alvo: form.sem_prazo ? null : form.data_alvo || null,
    })
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <label className={labelClass}>
        Título
        <input
          className={fieldClass}
          maxLength={200}
          name="titulo"
          onChange={updateField}
          placeholder="Ex.: Consolidar rotina de treino"
          required
          value={form.titulo}
        />
      </label>

      <section className="grid gap-3 border-y border-border py-4" aria-labelledby="prazo-title">
        <div>
          <h3
            id="prazo-title"
            className="m-0 text-base font-semibold normal-case text-text-primary"
          >
            Prazo
          </h3>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            Opcional. Você pode definir uma data alvo.
          </p>
        </div>
        <label className="inline-flex min-h-11 items-center gap-3 text-sm font-medium normal-case text-text-primary">
          <input
            checked={form.sem_prazo}
            className="size-5 min-h-0 w-5 accent-selection-border"
            name="sem_prazo"
            onChange={updateField}
            type="checkbox"
          />
          Sem prazo
        </label>
        {!form.sem_prazo && (
          <label className={labelClass}>
            Data alvo
            <input
              className={fieldClass}
              name="data_alvo"
              onChange={updateField}
              required
              type="date"
              value={form.data_alvo}
            />
          </label>
        )}
      </section>

      <label className={labelClass}>
        Propósito (opcional)
        <textarea
          className={`${fieldClass} min-h-28 resize-y`}
          name="descricao"
          onChange={updateField}
          placeholder="Por que esta direção importa para você?"
          rows={4}
          value={form.descricao}
        />
      </label>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={loading} variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button loading={loading} type="submit">
          {isEditing ? "Salvar objetivo" : "Criar objetivo"}
        </Button>
      </div>
    </form>
  )
}
