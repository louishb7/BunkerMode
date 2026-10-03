import React, { useEffect, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import { useApiAvailability } from "../../offline/useApiAvailability"
import {
  applyMyVersion,
  discardOperation,
  discardForServerVersion,
  retryOperation,
  subscribeOutbox,
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
  reserve: "Reserva",
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

export default function OutboxNotice() {
  const auth = useAuth()
  const availability = useApiAvailability()
  const ownerId = auth.user?.id
  const [items, setItems] = useState<OutboxOperation[]>([])
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
  useEffect(() => {
    if (!ownerId) {
      setItems([])
      return
    }
    return subscribeOutbox(ownerId, setItems)
  }, [ownerId])
  if (!ownerId || !items.length) return null
  return (
    <details className="border-b border-border px-4 py-1.5 text-xs" aria-label="Alterações locais">
      <summary className="cursor-pointer">
        {items.length} {items.length === 1 ? "alteração local" : "alterações locais"} aguardando
        sincronização
      </summary>
      <div className="mx-auto grid max-w-3xl gap-2 py-2">
        {actionError && <p className="text-danger">{actionError}</p>}
        {items.map((item) => (
          <div key={item.operationId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {domains[item.domain]} · {actions[item.action] ?? "alteração"}
            </span>
            <SyncLabel status={item.status} />
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
