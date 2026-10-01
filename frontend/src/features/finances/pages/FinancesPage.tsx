import React, { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import Button from "../../../components/ui/Button"
import PageHeader from "../../../components/ui/PageHeader"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Dialog from "../../../components/ui/Dialog"
import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import LoadingLines from "../../../components/ui/LoadingLines"
import OfflineNotice from "../../../components/system/OfflineNotice"
import { operationalDateFor } from "../../calendar/calendarUtils"
import { useFinances } from "../hooks/useFinances"
import { money } from "../money"
import FinanceForm from "../components/FinanceForm"

function monthOffset(value, offset) {
  const [year, month] = value.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`
}
function monthLabel(value) {
  const [year, month] = value.split("-").map(Number)
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)))
  return label[0].toLocaleUpperCase("pt-BR") + label.slice(1)
}
function ResultChart({ points = [], hasMovements = false }) {
  const values = points.map((item) => item.resultado_centavos)
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values)
  const span = Math.max(1, max - min)
  const y = (value) => 114 - ((value - min) / span) * 94
  const path = values
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${((index / Math.max(1, values.length - 1)) * 600).toFixed(1)} ${y(value).toFixed(1)}`
    )
    .join(" ")
  return (
    <div className="finance-chart">
      <div className="finance-chart-heading">
        <h2>Evolução no mês</h2>
        <span>Resultado acumulado</span>
      </div>
      {!hasMovements ? (
        <p className="empty-copy">Ainda não há entradas ou saídas para mostrar.</p>
      ) : (
        <svg
          role="img"
          aria-label="Evolução diária do resultado do mês"
          viewBox="0 0 600 130"
          preserveAspectRatio="none"
        >
          <line
            x1="0"
            x2="600"
            y1={y(0)}
            y2={y(0)}
            stroke="var(--color-border-strong)"
            strokeDasharray="4 5"
          />
          {values.length > 0 && (
            <path
              d={path}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
      {hasMovements && (
        <div className="finance-chart-ends">
          <span>Início</span>
          <span>Fim do mês</span>
        </div>
      )}
    </div>
  )
}

export default function FinancesPage({ token, user, onUnauthorized }) {
  const todayDate = operationalDateFor(user?.timezone)
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`
  const currentMonth = today.slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const finance = useFinances({ token, ownerId: user.id, onUnauthorized, month })
  const [form, setForm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const data = finance.data
  async function save(payload, id) {
    if (await finance.saveEntry(payload, id)) setForm(null)
  }
  return (
    <section className="finance-page">
      <PageHeader
        title="Finanças"
        actions={
          <Button onClick={() => setForm({ item: null })}>
            <Plus size={17} aria-hidden="true" /> Movimento
          </Button>
        }
      />
      <OfflineNotice updatedAt={finance.lastUpdated} />
      {finance.error && !form && !deleting && (
        <div role="alert" className="text-sm text-danger">
          {finance.error}{" "}
          <Button variant="ghost" onClick={finance.refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="finance-month" aria-label="Período financeiro">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMonth((value) => monthOffset(value, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <strong>{monthLabel(month)}</strong>
        <button
          type="button"
          aria-label="Próximo mês"
          disabled={month >= currentMonth}
          onClick={() => setMonth((value) => monthOffset(value, 1))}
        >
          <ChevronRight size={20} />
        </button>
        {month !== currentMonth && (
          <button type="button" className="finance-current" onClick={() => setMonth(currentMonth)}>
            Mês atual
          </button>
        )}
      </div>
      {!data ? (
        finance.loading ? (
          <LoadingLines label="Carregando finanças" />
        ) : null
      ) : (
        <>
          <section className="finance-state" aria-label="Resultado financeiro do mês">
            <p className="eyebrow">Resultado do mês</p>
            <p className={`finance-result ${data.resultado_centavos < 0 ? "text-danger" : ""}`}>
              {money(data.resultado_centavos)}
            </p>
            <dl className="finance-flow">
              <div>
                <dt>Entradas</dt>
                <dd>{money(data.receitas_centavos)}</dd>
              </div>
              <div>
                <dt>Saídas</dt>
                <dd>{money(data.despesas_centavos)}</dd>
              </div>
            </dl>
          </section>
          <ResultChart
            points={data.serie_diaria}
            hasMovements={data.receitas_centavos + data.despesas_centavos > 0}
          />
          <section className="finance-movements" aria-labelledby="finance-movements-title">
            <h2 id="finance-movements-title">Movimentos recentes</h2>
            {!data.lancamentos.length ? (
              <p className="empty-copy">Nenhum movimento neste mês.</p>
            ) : (
              <ol className="finance-ledger">
                {data.lancamentos.map((entry) => {
                  const incoming = entry.tipo === "receita" || entry.tipo === "ajuste_entrada"
                  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
                  return (
                    <li key={entry.id} className="ledger-row">
                      <Icon size={18} aria-hidden="true" />
                      <div className="min-w-0">
                        <strong>{entry.titulo}</strong>
                        <span>
                          {entry.data.split("-").reverse().join("/")}
                          {entry.tipo.startsWith("ajuste") ? " · Ajuste de saldo" : ""}
                        </span>
                      </div>
                      <span className="ledger-amount">
                        {incoming ? "+" : "−"} {money(entry.valor_centavos)}
                      </span>
                      <ActionsMenu
                        label={`Ações do movimento: ${entry.titulo}`}
                        disabled={finance.busy}
                        items={[
                          { label: "Editar movimento", onSelect: () => setForm({ item: entry }) },
                          {
                            label: "Excluir movimento",
                            onSelect: () => setDeleting(entry),
                            danger: true,
                          },
                        ]}
                      />
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </>
      )}
      {form && (
        <Dialog
          title={form.item ? "Editar movimento" : "Novo movimento"}
          onClose={() => setForm(null)}
          closeOnBackdrop={false}
        >
          <FinanceForm
            key={form.item?.id ?? "new"}
            item={form.item}
            today={today}
            busy={finance.busy}
            error={finance.error}
            onSave={save}
            onCancel={() => setForm(null)}
          />
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir movimento"
          message={`O movimento "${deleting.titulo}" será excluído e o resultado será recalculado.`}
          confirmLabel="Excluir"
          error={finance.error}
          loading={finance.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (await finance.deleteEntry(deleting.id)) setDeleting(null)
          }}
        />
      )}
    </section>
  )
}
