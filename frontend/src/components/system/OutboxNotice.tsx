import React, { useState } from "react"
import { CircleAlert, RefreshCw } from "lucide-react"
import { useAuth } from "../../context/AuthContext"
import { useSyncStatus } from "../../context/SyncStatusContext"
import { useApiAvailability } from "../../offline/useApiAvailability"
import {
  applyMyVersion,
  discardOperation,
  discardForServerVersion,
  retryOperation,
  syncOutbox,
} from "../../offline/outbox"
import type { OutboxOperation } from "../../offline/snapshots"
import SyncLabel from "./SyncLabel"

const domains: Record<OutboxOperation["domain"], string> = {
  task: "Tarefa",
  goal: "Objetivo",
  tracker: "Acompanhamento",
  occurrence: "Ocorrência",
  entry: "Lançamento",
}
const actions: Record<string, string> = {
  create: "criação",
  update: "edição",
  complete: "conclusão",
  reopen: "reabertura",
  pin: "fixação",
  delete: "exclusão",
  link: "vínculo",
  unlink: "desvínculo",
  status: "status",
}

export default function OutboxNotice({ align = "right" }: { align?: "left" | "right" }) {
  const auth = useAuth()
  const availability = useApiAvailability()
  const sync = useSyncStatus()
  const items = sync.items
  const ownerId = auth.user?.id
  const [actionError, setActionError] = useState("")
  async function runAction(action: () => Promise<unknown>) {
    setActionError("")
    try {
      const result = await action()
      if (result === false) setActionError("Não foi possível concluir a ação. Tente novamente.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível concluir a ação.")
    }
  }
  if (!ownerId || sync.state === "normal") return null
  const needsAction = sync.state === "conflict" || sync.state === "failed"
  const attention = needsAction || sync.state === "offline" || sync.state === "unavailable"
  return (
    <details className="relative text-xs" aria-label="Sincronização">
      <summary
        className={`relative grid size-9 cursor-pointer list-none place-items-center rounded-control [&::-webkit-details-marker]:hidden ${needsAction ? "text-danger" : "text-text-secondary"}`}
        aria-label={sync.message || "Sincronizando"}
        title={sync.message || "Sincronizando"}
      >
        {needsAction ? (
          <CircleAlert size={17} aria-hidden="true" />
        ) : (
          <RefreshCw
            size={17}
            aria-hidden="true"
            className={
              sync.state === "syncing" ? "animate-spin motion-reduce:animate-none opacity-60" : ""
            }
          />
        )}
        {attention && (
          <span
            className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-danger"
            aria-hidden="true"
          />
        )}
      </summary>
      <div
        className={`absolute ${align === "left" ? "left-0" : "right-0"} z-40 grid w-[min(320px,calc(100vw-2rem))] gap-3 rounded-xl border border-border bg-surface p-4 shadow-overlay`}
      >
        <p className="m-0 font-medium">
          {items.length} {items.length === 1 ? "alteração" : "alterações"} por sincronizar
        </p>
        {actionError && <p className="text-danger">{actionError}</p>}
        {items.map((item) => (
          <div key={item.operationId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {domains[item.domain]} · {actions[item.action] ?? "alteração"}
            </span>
            <SyncLabel status={item.status} detailed />
            {item.error && <span className="text-danger">{item.error}</span>}
            {item.status === "conflict" ? (
              <>
                <button
                  className="underline"
                  onClick={() =>
                    void runAction(() => discardForServerVersion(ownerId, item.operationId))
                  }
                >
                  Usar versão do servidor
                </button>
                {["task", "goal", "tracker"].includes(item.domain) &&
                  ["update", "status", "pin", "link", "unlink"].includes(item.action) && (
                    <button
                      className="underline"
                      onClick={() =>
                        void runAction(() => applyMyVersion(ownerId, item.operationId))
                      }
                    >
                      Aplicar minha alteração
                    </button>
                  )}
              </>
            ) : (
              <>
                {item.status === "failed" && (
                  <button
                    className="underline"
                    onClick={() => void runAction(() => retryOperation(ownerId, item.operationId))}
                  >
                    Tentar novamente
                  </button>
                )}
                {(!item.attemptedAt || item.status === "failed") && (
                  <button
                    className="underline"
                    onClick={() =>
                      void runAction(() => discardOperation(ownerId, item.operationId))
                    }
                  >
                    Descartar
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {availability === "available" && auth.sessionMode === "online" && (
          <button className="w-fit font-medium underline" onClick={() => void syncOutbox(ownerId)}>
            Sincronizar agora
          </button>
        )}
      </div>
    </details>
  )
}
