import React, { useState } from "react"

import Button from "../../../components/ui/Button"

const fieldClass = "min-h-11 w-full rounded-control border border-control-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"

export default function TrackerForm({ tracker = null, objetivoTitulo = "", loading = false, onCancel, onSubmit }) {
  const [titulo, setTitulo] = useState(tracker?.titulo ?? "")
  const [descricao, setDescricao] = useState(tracker?.descricao ?? "")

  function submit(event) {
    event.preventDefault()
    if (!titulo.trim()) return
    onSubmit({ titulo: titulo.trim(), descricao: descricao.trim() || null })
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      {objetivoTitulo && <p className="m-0 text-sm text-text-secondary">Objetivo: {objetivoTitulo}</p>}
      <label className="grid gap-2 text-sm font-medium">
        Nome
        <input className={fieldClass} maxLength={200} required value={titulo} onChange={(event) => setTitulo(event.target.value)} placeholder="Ex.: Não fumar maconha" />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Descrição opcional
        <textarea className={`${fieldClass} min-h-20 resize-y`} rows={3} value={descricao} onChange={(event) => setDescricao(event.target.value)} />
      </label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={loading} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" loading={loading}>{tracker ? "Salvar" : "Adicionar acompanhamento"}</Button>
      </div>
    </form>
  )
}
