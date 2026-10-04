import React from "react"
import { Link } from "react-router-dom"
import Button from "../../../components/ui/Button"
import Dialog from "../../../components/ui/Dialog"
import SyncLabel from "../../../components/system/SyncLabel"
import { displayDate, nodeFact } from "../objectiveMapModel"

export default function ObjectiveNodeDetails({
  node,
  task = null,
  tracker = null,
  timezone,
  now = new Date(),
  readOnly = false,
  onClose,
  onCompleteTask = undefined,
  onUnlinkTask = undefined,
  onRecordOccurrence = undefined,
  onEditTracker = undefined,
  onUnlinkTracker = undefined,
  onDeleteTracker = undefined,
  onDeleteOccurrence = undefined,
  error = "",
}) {
  return (
    <Dialog className="objective-node-details" title={node.titulo} onClose={onClose}>
      <div className="node-detail-copy">
        <p className="eyebrow">
          {node.tipo === "rotina"
            ? "Tarefa recorrente"
            : node.tipo === "tarefa"
              ? "Tarefa"
              : "Acompanhamento"}
          {readOnly ? " · Memória da conquista" : ""}
        </p>
        <p>{nodeFact(node, timezone, now)}</p>
        {node.descricao && <p className="whitespace-pre-line">{node.descricao}</p>}
        <SyncLabel status={task?.syncStatus || tracker?.syncStatus} />
        {node.tipo === "rotina" && (
          <>
            <p>
              {node.realizadas ?? 0}{" "}
              {(node.realizadas ?? 0) === 1 ? "ocorrência concluída" : "ocorrências concluídas"}
            </p>
            {node.frequencia?.length > 0 && (
              <p>
                Frequência:{" "}
                {node.frequencia
                  .map((day) => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day])
                  .join(", ")}
              </p>
            )}
            {!readOnly && task && (
              <p>
                Ocorrência selecionada:{" "}
                {task.status === "CONCLUIDA"
                  ? "concluída"
                  : task.status_code === "NAO_REALIZADA"
                    ? "não realizada"
                    : "pendente"}
                {task.prazo ? ` · ${displayDate(task.prazo, timezone)}` : ""}
              </p>
            )}
          </>
        )}
        {node.tipo === "acompanhamento" && (
          <>
            <p>
              Ocorrências são registros manuais. O intervalo desde o último registro não confirma
              dias de abstinência.
            </p>
            {node.ocorrencias_total !== undefined && (
              <p>{node.ocorrencias_total} ocorrências registradas até a conquista.</p>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!readOnly && task && (
        <div className="node-detail-actions">
          {task.permissions?.can_complete && (
            <Button
              variant="secondary"
              disabled={Boolean(task.syncStatus)}
              onClick={() => onCompleteTask(task)}
            >
              Concluir tarefa
            </Button>
          )}
          <Link className="text-link" to="/tarefas">
            Abrir em Tarefas
          </Link>
          <Button
            variant="ghost"
            disabled={Boolean(task.syncStatus)}
            onClick={() => {
              onClose()
              onUnlinkTask(task)
            }}
          >
            Desvincular
          </Button>
        </div>
      )}
      {!readOnly && tracker && (
        <>
          <div className="node-detail-actions">
            <Button
              variant="secondary"
              disabled={Boolean(tracker.syncStatus)}
              onClick={() => onRecordOccurrence(tracker)}
            >
              Registrar ocorrência
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onClose()
                onEditTracker(tracker)
              }}
            >
              Editar
            </Button>
            <Button
              variant="ghost"
              disabled={Boolean(tracker.syncStatus)}
              onClick={async () => {
                if (await onUnlinkTracker(tracker)) onClose()
              }}
            >
              Desvincular
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onClose()
                onDeleteTracker(tracker)
              }}
            >
              Excluir
            </Button>
          </div>
          {tracker.ocorrencias?.length > 0 && (
            <section aria-label="Ocorrências recentes">
              <h3 className="text-sm">Últimas ocorrências</h3>
              <ol className="objective-occurrences">
                {tracker.ocorrencias.slice(0, 5).map((event) => (
                  <li key={event.id}>
                    <span>
                      {new Date(event.occurred_at).toLocaleString("pt-BR", { timeZone: timezone })}
                    </span>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={Boolean(tracker.syncStatus)}
                      onClick={() => onDeleteOccurrence(tracker, event)}
                    >
                      Remover ocorrência
                    </Button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      <Button variant="secondary" onClick={onClose}>
        Fechar
      </Button>
    </Dialog>
  )
}
