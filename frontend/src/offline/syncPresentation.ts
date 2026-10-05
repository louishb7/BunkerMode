import type { ApiAvailability } from "./apiAvailability"
import type { OutboxOperation } from "./snapshots"

export function deriveSyncPresentation({
  items,
  online,
  availability,
  replaying,
  now = Date.now(),
}: {
  items: OutboxOperation[]
  online: boolean
  availability: ApiAvailability
  replaying: boolean
  now?: number
}) {
  const pendingCount = items.filter((item) => ["pending", "syncing"].includes(item.status)).length
  const conflictCount = items.filter((item) => item.status === "conflict").length
  const failedCount = items.filter((item) => item.status === "failed").length
  const stalled =
    online &&
    !replaying &&
    items.some(
      (item) =>
        ["pending", "syncing"].includes(item.status) &&
        now - Date.parse(item.createdAt) > 15 * 60_000
    )
  const state = conflictCount
    ? "conflict"
    : failedCount
      ? "failed"
      : !online
        ? "offline"
        : stalled
          ? "stalled"
          : availability === "unavailable"
            ? "unavailable"
            : "normal"
  const message =
    state === "conflict"
      ? "Há uma alteração em conflito. Revise em Configurações."
      : state === "failed"
        ? "Uma alteração não foi aceita. Revise em Configurações."
        : state === "unavailable"
          ? "Serviço temporariamente indisponível"
          : state === "offline"
            ? "Sem conexão"
            : state === "stalled"
              ? "Há alterações sem confirmação há algum tempo. Revise em Configurações."
              : ""
  return { state, message, pendingCount, conflictCount, failedCount }
}
