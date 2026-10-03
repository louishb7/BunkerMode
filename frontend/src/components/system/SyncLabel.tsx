import React from "react"

const labels: Record<string, string> = {
  syncing: "Sincronizando",
  failed: "Não foi possível sincronizar",
  conflict: "Conflito de sincronização",
}

export default function SyncLabel({ status }: { status?: string }) {
  if (!status || !labels[status]) return null
  return (
    <span className="text-[11px] text-text-secondary" role="status">
      {labels[status]}
    </span>
  )
}
