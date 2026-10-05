import React, { useState } from "react"
import { Link } from "react-router-dom"
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
import { api } from "../../services/bunkermodeApi"
import SyncLabel from "./SyncLabel"

const domains: Record<OutboxOperation["domain"], string> = {
  task: "Tarefa",
  goal: "Objetivo",
  tracker: "Comportamento",
  occurrence: "Registro",
  entry: "Movimento",
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
  status: "estado",
}
export default function OutboxNotice({
  diagnostic = false,
}: {
  align?: "left" | "right"
  diagnostic?: boolean
}) {
  const auth = useAuth()
  const availability = useApiAvailability()
  const sync = useSyncStatus()
  const ownerId = auth.user?.id
  const [actionError, setActionError] = useState("")
  const [busy, setBusy] = useState(false)
  async function runAction(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setActionError("")
    try {
      if ((await action()) === false)
        setActionError("Não foi possível concluir a ação. Tente novamente.")
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível concluir a ação.")
    } finally {
      setBusy(false)
    }
  }
  if (!ownerId) return null
  const needsAction = ["conflict", "failed", "stalled"].includes(sync.state)
  if (!diagnostic)
    return needsAction ? (
      <Link
        to="/configuracoes#sincronizacao"
        className="text-link text-xs"
        aria-label="Revisar alterações locais"
      >
        <CircleAlert size={17} aria-hidden="true" /> Revisar
      </Link>
    ) : null
  let lastSync: string | null = null
  try {
    lastSync = window.localStorage.getItem(`bunkermode_last_sync:${ownerId}`)
  } catch {
    /* Metadado opcional. */
  }
  return (
    <section
      id="sincronizacao"
      className="work-surface grid gap-3 p-5 text-sm sm:p-6"
      aria-labelledby="sync-title"
    >
      <h2 id="sync-title" className="m-0 text-base font-semibold">
        Sincronização deste dispositivo
      </h2>
      <p className="m-0 text-text-secondary">
        API:{" "}
        {availability === "available"
          ? "disponível"
          : availability === "unavailable"
            ? "indisponível"
            : "a verificar"}
      </p>
      <dl className="flex flex-wrap gap-5 text-xs">
        <div>
          <dt>Pendentes</dt>
          <dd className="m-0">{sync.pendingCount}</dd>
        </div>
        <div>
          <dt>Não aceitas</dt>
          <dd className="m-0">{sync.failedCount}</dd>
        </div>
        <div>
          <dt>Conflitos</dt>
          <dd className="m-0">{sync.conflictCount}</dd>
        </div>
      </dl>
      <p className="m-0 text-xs text-text-secondary">
        Última confirmação:{" "}
        {lastSync && Number.isFinite(Date.parse(lastSync))
          ? new Date(lastSync).toLocaleString("pt-BR")
          : "nenhuma neste dispositivo"}
      </p>
      {actionError && (
        <p role="alert" className="text-danger">
          {actionError}
        </p>
      )}
      {sync.items.map((item) => (
        <div
          key={item.operationId}
          className="flex flex-wrap items-center gap-3 border-t border-border py-3"
        >
          <span className="font-medium">
            {domains[item.domain]} · {actions[item.action] ?? "alteração"}
            {item.payload.titulo ? ` · ${item.payload.titulo}` : ""}
          </span>
          <SyncLabel status={item.status} detailed />
          {item.error && <span className="text-danger">{item.error}</span>}
          {(item.status === "failed" || item.status === "conflict") && (
            <details className="w-full text-xs">
              <summary className="min-h-11 cursor-pointer">
                Detalhes da alteração preservada
              </summary>
              <pre className="m-0 whitespace-pre-wrap break-words text-text-secondary">
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </details>
          )}
          {item.status === "conflict" ? (
            <>
              <button
                className="min-h-11 underline"
                disabled={busy}
                onClick={() =>
                  void runAction(() => discardForServerVersion(ownerId, item.operationId))
                }
              >
                Usar versão do servidor
              </button>
              {["task", "goal", "tracker"].includes(item.domain) &&
                ["update", "status", "pin", "link", "unlink"].includes(item.action) && (
                  <button
                    className="min-h-11 underline"
                    disabled={busy}
                    onClick={() => void runAction(() => applyMyVersion(ownerId, item.operationId))}
                  >
                    Aplicar minha alteração
                  </button>
                )}
            </>
          ) : (
            <>
              {item.status === "failed" && (
                <button
                  className="min-h-11 underline"
                  disabled={busy}
                  onClick={() => void runAction(() => retryOperation(ownerId, item.operationId))}
                >
                  Tentar esta alteração novamente
                </button>
              )}
              {(!item.attemptedAt || item.status === "failed") && (
                <button
                  className="min-h-11 underline"
                  disabled={busy}
                  onClick={() => void runAction(() => discardOperation(ownerId, item.operationId))}
                >
                  Descartar
                </button>
              )}
            </>
          )}
        </div>
      ))}
      <button
        className="flex min-h-11 w-fit items-center gap-2 font-medium underline"
        disabled={busy}
        onClick={() =>
          void runAction(async () => {
            const result = await api.getCurrentUser(auth.token)
            if (auth.handleUnauthorized?.(result) || !result.ok) return false
            await syncOutbox(ownerId)
          })
        }
      >
        <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
      </button>
    </section>
  )
}
