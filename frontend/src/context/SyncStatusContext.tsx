import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react"
import { useAuth } from "./AuthContext"
import { useApiAvailability } from "../offline/useApiAvailability"
import { useOnlineStatus } from "../offline/useOnlineStatus"
import { getReplayOwner, subscribeReplay, subscribeOutbox } from "../offline/outbox"
import { deriveSyncPresentation } from "../offline/syncPresentation"
import type { OutboxOperation } from "../offline/snapshots"

const SyncStatusContext = createContext<
  (ReturnType<typeof deriveSyncPresentation> & { items: OutboxOperation[] }) | null
>(null)

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const ownerId = useAuth().user?.id
  const online = useOnlineStatus()
  const availability = useApiAvailability()
  const replayOwner = useSyncExternalStore(subscribeReplay, getReplayOwner)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [outbox, setOutbox] = useState<{ ownerId?: number; items: OutboxOperation[] }>({
    items: [],
  })
  useEffect(() => {
    if (!ownerId) return
    return subscribeOutbox(ownerId, (items) => setOutbox({ ownerId, items }))
  }, [ownerId])
  const items = ownerId && outbox.ownerId === ownerId ? outbox.items : []
  const presentation = deriveSyncPresentation({
    items,
    online,
    availability,
    replaying: !!ownerId && replayOwner === ownerId,
    now,
  })
  return (
    <SyncStatusContext.Provider value={{ ...presentation, items }}>
      {children}
    </SyncStatusContext.Provider>
  )
}

export function useSyncStatus() {
  const status = useContext(SyncStatusContext)
  if (!status) throw new Error("useSyncStatus deve ser usado dentro de SyncStatusProvider.")
  return status
}
