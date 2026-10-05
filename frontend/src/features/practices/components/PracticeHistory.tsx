import React, { useState } from "react"
import { Star } from "lucide-react"
import Button from "../../../components/ui/Button"
import type { Tracker, TrackerOccurrence } from "../../../types/trackerContract"
import { derivePractice, practicePlanLabel } from "../practiceDomain"

export default function PracticeHistory({
  tracker,
  timezone,
  onDeleteOccurrence,
  now = new Date(),
}: {
  tracker: Tracker
  timezone?: string
  onDeleteOccurrence?: (tracker: Tracker, record: TrackerOccurrence) => unknown
  now?: Date
}) {
  const facts = derivePractice(tracker, now, timezone)
  const [days, setDays] = useState(30)
  const [page, setPage] = useState(1)
  const window = facts.windows.find((item) => item.days === days)
  const records = [...tracker.ocorrencias].sort(
    (left, right) =>
      right.occurred_at.localeCompare(left.occurred_at) ||
      String(right.id).localeCompare(String(left.id))
  )
  const pageCount = Math.max(1, Math.ceil(records.length / 8))
  const currentPage = Math.min(page, pageCount)
  const date = (day: string) => day.split("-").reverse().join("/")
  return (
    <div className="practice-history grid gap-4 text-sm">
      {facts.quantityTotals.length > 0 && (
        <p className="m-0 text-text-secondary">
          Total registrado:{" "}
          {facts.quantityTotals
            .map((item) => `${item.amount.toLocaleString("pt-BR")} ${item.unit}`)
            .join(" · ")}
        </p>
      )}
      {tracker.intent && tracker.intent !== "registro_livre" && (
        <details>
          <summary className="min-h-11 cursor-pointer font-medium">
            Histórico e consistência
          </summary>
          <label className="flex flex-wrap items-center gap-2">
            Períodos encerrados
            <select
              aria-label="Janela de consistência"
              className="min-h-11 rounded-control border border-control-border bg-surface px-3"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              {[7, 30, 60, 90].map((value) => (
                <option key={value} value={value}>
                  Últimos {value} dias
                </option>
              ))}
            </select>
          </label>
          <p>
            {window.fulfilled}/{window.expected} oportunidades encerradas com meta registrada
            {tracker.intent === "repetir" ? "" : " e observação confirmada"}.
          </p>
          <p className="text-xs text-text-secondary">
            {window.unknown} sem informação. O total exclui períodos futuros, anteriores ao início,
            pausas e semanas incompletas. Ausência de registro não confirma sucesso nem fracasso.
          </p>
          <p>
            Sequência registrada: {facts.currentStreak} · Melhor sequência: {facts.bestStreak}{" "}
            oportunidades.
          </p>
          <h4 className="text-sm">Vigência das metas</h4>
          <ol className="practice-plans m-0 list-none p-0">
            {(tracker.planos ?? []).map((plan, index) => (
              <li className="border-t border-border py-2" key={plan.id ?? index}>
                <strong>
                  {date(plan.effective_from)}
                  {plan.effective_until
                    ? ` até ${date(plan.effective_until)} (exclusivo)`
                    : " em diante"}
                </strong>
                <span className="block text-text-secondary">
                  {plan.paused ? "Pausa" : practicePlanLabel(plan)}
                  {plan.target_amount != null
                    ? ` · ${tracker.intent === "reduzir" ? "limite " : ""}${plan.target_amount} ${plan.unit ?? "unidades"}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {facts.milestones.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Marcos de atividade">
          {facts.milestones.map((mark) => (
            <li className="flex items-center gap-2" key={mark}>
              <Star size={16} aria-hidden="true" />
              {mark}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer font-medium">
          Registros · {records.length}
        </summary>
        {!records.length ? (
          <p className="text-text-secondary">Ainda não há registros.</p>
        ) : (
          <ol className="objective-occurrences">
            {records.slice((currentPage - 1) * 8, currentPage * 8).map((record) => (
              <li key={record.id}>
                <div className="min-w-0">
                  <strong className="block">
                    {record.kind === "confirmacao"
                      ? "Período observado"
                      : record.kind === "atividade"
                        ? "Atividade registrada"
                        : "Ocorrência registrada"}
                    {record.amount != null
                      ? ` · ${record.amount.toLocaleString("pt-BR")} ${record.unit ?? "unidades"}`
                      : ""}
                  </strong>
                  <span>
                    {new Date(record.occurred_at).toLocaleString("pt-BR", {
                      timeZone: tracker.planos?.[0]?.timezone ?? timezone,
                    })}
                  </span>
                  {record.note && (
                    <p className="my-1 whitespace-pre-line break-words text-text-secondary">
                      {record.note}
                    </p>
                  )}
                </div>
                {onDeleteOccurrence && (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => onDeleteOccurrence(tracker, record)}
                  >
                    Remover ocorrência
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
        {pageCount > 1 && (
          <nav className="flex flex-wrap items-center gap-3" aria-label="Paginação dos registros">
            <Button
              variant="secondary"
              size="small"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Anterior
            </Button>
            <span role="status">
              {currentPage} de {pageCount}
            </span>
            <Button
              variant="secondary"
              size="small"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Próxima
            </Button>
          </nav>
        )}
      </details>
    </div>
  )
}
