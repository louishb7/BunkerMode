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
import SyncLabel from "../../../components/system/SyncLabel"

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
  const hasFlow = points.some((point) => point.receitas_centavos !== undefined)
  const series = [
    {
      key: "resultado_centavos",
      label: "Resultado",
      color: "var(--color-text-secondary)",
      className: "chart-result",
    },
    ...(hasFlow
      ? [
          {
            key: "receitas_centavos",
            label: "Entradas",
            color: "var(--color-success)",
            className: "chart-income",
          },
          {
            key: "despesas_centavos",
            label: "Saídas",
            color: "var(--color-danger)",
            className: "chart-expense",
            dashed: true,
          },
        ]
      : []),
  ]
  const values = series.flatMap((line) => points.map((point) => point[line.key] ?? 0))
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values)
  const span = Math.max(1, max - min)
  const y = (value) => 114 - ((value - min) / span) * 94
  const path = (key) =>
    points
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${((index / Math.max(1, points.length - 1)) * 600).toFixed(1)} ${y(point[key] ?? 0).toFixed(1)}`
      )
      .join(" ")
  return (
    <div className="finance-chart">
      <div className="finance-chart-heading">
        <h2>Evolução no mês</h2>
        <span>Valores acumulados em R$</span>
      </div>
      {!hasMovements ? (
        <p className="empty-copy">Ainda não há entradas ou saídas para mostrar.</p>
      ) : (
        <svg
          role="img"
          aria-label="Evolução diária de entradas, saídas e resultado do mês"
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
          {series.map((line) => (
            <path
              key={line.key}
              d={path(line.key)}
              fill="none"
              stroke={line.color}
              strokeWidth="2"
              strokeDasharray={line.dashed ? "6 4" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            >
              <title>{line.label}</title>
            </path>
          ))}
        </svg>
      )}
      {hasMovements && (
        <div className="finance-chart-legend">
          {series.map((line) => (
            <span key={line.key} className={line.className}>
              {line.label}
            </span>
          ))}
        </div>
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
  const [historyPage, setHistoryPage] = useState(1)
  const data = finance.data
  const pageCount = Math.max(1, Math.ceil((data?.lancamentos.length ?? 0) / 8))
  const page = Math.min(historyPage, pageCount)
  const movements = data?.lancamentos.slice((page - 1) * 8, page * 8) ?? []
  function selectMonth(value) {
    setMonth(value)
    setHistoryPage(1)
  }
  async function save(payload, id) {
    if (await finance.saveEntry(payload, id)) {
      setForm(null)
      setHistoryPage(1)
    }
  }
  return (
    <section className="finance-page">
      <PageHeader title="Finanças" />
      <OfflineNotice updatedAt={finance.lastUpdated} />
      {!finance.hasOfficialSnapshot && finance.data && (
        <p className="text-xs text-text-secondary">Valores locais sem último saldo oficial.</p>
      )}
      {finance.error && !form && !deleting && (
        <div role="alert" className="text-sm text-danger">
          {finance.error}{" "}
          <Button variant="ghost" onClick={finance.refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="finance-toolbar">
        <div className="finance-month" aria-label="Período financeiro">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => selectMonth(monthOffset(month, -1))}
          >
            <ChevronLeft size={20} />
          </button>
          <strong>{monthLabel(month)}</strong>
          <button
            type="button"
            aria-label="Próximo mês"
            disabled={month >= currentMonth}
            onClick={() => selectMonth(monthOffset(month, 1))}
          >
            <ChevronRight size={20} />
          </button>
          {month !== currentMonth && (
            <button
              type="button"
              className="finance-current"
              onClick={() => selectMonth(currentMonth)}
            >
              Mês atual
            </button>
          )}
        </div>
        <Button onClick={() => setForm({ item: null })}>
          <Plus size={17} aria-hidden="true" /> Movimento
        </Button>
      </div>
      {!data ? (
        finance.loading ? (
          <LoadingLines label="Carregando finanças" />
        ) : null
      ) : (
        <>
          <section className="finance-state" aria-label="Resultado financeiro do mês">
            <p className="eyebrow">Saldo registrado</p>
            <p className={`finance-result ${data.saldo_centavos < 0 ? "text-danger" : ""}`}>
              {money(data.saldo_centavos)}
            </p>
            <p className="text-sm text-text-secondary">
              Resultado do mês: {money(data.resultado_centavos)}
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
            <h2 id="finance-movements-title">Histórico de movimentos</h2>
            {!data.lancamentos.length ? (
              <p className="empty-copy">Nenhum movimento neste mês.</p>
            ) : (
              <ol className="finance-ledger">
                {movements.map((entry) => {
                  const incoming = entry.tipo === "receita" || entry.tipo === "ajuste_entrada"
                  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
                  return (
                    <li
                      key={entry.id}
                      className={`ledger-row ${incoming ? "ledger-income" : "ledger-expense"}`}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <div className="min-w-0">
                        <strong>{entry.titulo}</strong>
                        <SyncLabel status={entry.syncStatus} />
                        <span>
                          {incoming ? "Entrada" : "Saída"} ·{" "}
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
            {pageCount > 1 && (
              <nav className="finance-pagination" aria-label="Paginação dos movimentos">
                <Button
                  variant="secondary"
                  disabled={page === 1}
                  onClick={() => setHistoryPage(page - 1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Anterior
                </Button>
                <span role="status">
                  Página {page} de {pageCount}
                </span>
                <Button
                  variant="secondary"
                  disabled={page === pageCount}
                  onClick={() => setHistoryPage(page + 1)}
                >
                  Próxima <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </nav>
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
