import type { ApiAvailability } from "./apiAvailability"
import type { OutboxOperation } from "./snapshots"

export function deriveSyncPresentation({
  items,
  online,
  availability,
  replaying,
}: {
  items: OutboxOperation[]
  online: boolean
  availability: ApiAvailability
  replaying: boolean
}) {
  const pendingCount = items.filter((item) => ["pending", "syncing"].includes(item.status)).length
  const conflictCount = items.filter((item) => item.status === "conflict").length
  const failedCount = items.filter((item) => item.status === "failed").length
  const state = conflictCount
    ? "conflict"
    : failedCount
      ? "failed"
      : !pendingCount
        ? "normal"
        : !online
          ? "offline"
          : availability === "unavailable"
            ? "unavailable"
            : replaying
              ? "syncing"
              : "normal"
  const message =
    state === "conflict"
      ? "Conflito de sincronização · revise as alterações"
      : state === "failed"
        ? "Não foi possível sincronizar · revise as alterações"
        : state === "unavailable"
          ? `Não foi possível sincronizar · ${pendingCount} ${pendingCount === 1 ? "alteração pendente" : "alterações pendentes"}`
          : state === "offline"
            ? "Aguardando sincronização"
            : ""
  return { state, message, pendingCount, conflictCount, failedCount }
}
