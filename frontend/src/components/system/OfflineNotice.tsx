import React from "react"
import { useApiAvailability } from "../../offline/useApiAvailability"

export default function OfflineNotice({ updatedAt }: { updatedAt?: string | null }) {
  const availability = useApiAvailability()
  if (availability !== "unavailable" || !updatedAt) return null
  const timestamp = new Date(updatedAt)
  if (!Number.isFinite(timestamp.getTime())) return null
  return (
    <p className="m-0 text-xs text-text-secondary" role="status">
      Última atualização:{" "}
      {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        timestamp
      )}
    </p>
  )
}
