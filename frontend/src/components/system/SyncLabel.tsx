import React from "react"
import { CircleAlert } from "lucide-react"

const labels: Record<string, string> = {
  syncing: "Sincronizando",
  failed: "Não foi possível sincronizar",
  conflict: "Conflito de sincronização",
}

export default function SyncLabel({
  status,
  detailed = false,
}: {
  status?: string
  detailed?: boolean
}) {
  if (!status || !labels[status]) return null
  // Textos e ações pertencem à superfície central e aos detalhes do indicador.
  if (!detailed) {
    if (status !== "failed" && status !== "conflict") return null
    return <CircleAlert size={14} className="text-danger" aria-label={labels[status]} />
  }
  return <span className="text-[11px] text-text-secondary">{labels[status]}</span>
}
