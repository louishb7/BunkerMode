import React, { useRef, useState } from "react"
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
import FinanceChart from "../components/FinanceChart"

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
export default function FinancesPage({ token, user, onUnauthorized }) {
  const todayDate = operationalDateFor(user?.timezone)
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`
  const currentMonth = today.slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const finance = useFinances({ token, ownerId: user.id, onUnauthorized, month })
  const [form, setForm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [historyPage, setHistoryPage] = useState(1)
  const formDirty = useRef(false)
  const data = finance.data
  const pageCount = Math.max(1, Math.ceil((data?.lancamentos.length ?? 0) / 8))
  const page = Math.min(historyPage, pageCount)
  const movements = data?.lancamentos.slice((page - 1) * 8, page * 8) ?? []
  function selectMonth(value) {
    setMonth(value)
  }
  function closeForm() {
    if (finance.busy) return
    if (formDirty.current && !window.confirm("Descartar as alterações deste movimento?")) return
    formDirty.current = false
    setForm(null)
  }
  async function save(payload, id) {
    if (await finance.saveEntry(payload, id)) {
      setForm(null)
      formDirty.current = false
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
      <section className="finance-state" aria-labelledby="finance-global-title">
        <div>
          <h2 id="finance-global-title">Situação registrada</h2>
          <p className="finance-history-note">Saldo global · Todos os períodos</p>
          {data && (
            <p className={`finance-result ${data.saldo_centavos < 0 ? "text-danger" : ""}`}>
              {money(data.saldo_centavos)}
            </p>
          )}
        </div>
        <Button
          onClick={() => {
            formDirty.current = false
            setForm({ item: null })
          }}
        >
          <Plus size={17} aria-hidden="true" /> Movimento
        </Button>
      </section>
      {!data ? (
        finance.loading ? (
          <LoadingLines label="Carregando finanças" />
        ) : null
      ) : (
        <>
          <section className="finance-month-section" aria-labelledby="finance-month-title">
            <div className="finance-toolbar">
              <h2 id="finance-month-title">Resumo do mês</h2>
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
            </div>
            <dl className="finance-flow">
              <div>
                <dt>Resultado do mês</dt>
                <dd>{money(data.resultado_centavos)}</dd>
              </div>
              <div>
                <dt>Entradas</dt>
                <dd>{money(data.receitas_centavos)}</dd>
              </div>
              <div>
                <dt>Saídas</dt>
                <dd>{money(data.despesas_centavos)}</dd>
              </div>
            </dl>
            <FinanceChart
              key={month}
              points={data.serie_diaria}
              today={today}
              movementCount={
                data.lancamentos.filter(
                  (entry) =>
                    entry.data.startsWith(month) &&
                    ["receita", "despesa"].includes(entry.tipo) &&
                    !["failed", "conflict"].includes(entry.syncStatus)
                ).length
              }
            />
          </section>
          <section className="finance-movements" aria-labelledby="finance-movements-title">
            <h2 id="finance-movements-title">Histórico de movimentos</h2>
            <p className="finance-history-note">
              Todos os períodos, incluindo ajustes de saldo antigos.
            </p>
            {!data.lancamentos.length ? (
              <p className="empty-copy">Nenhum movimento registrado.</p>
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
                          {
                            label: "Editar movimento",
                            onSelect: () => {
                              formDirty.current = false
                              setForm({ item: entry })
                            },
                          },
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
          onClose={closeForm}
          closeOnBackdrop={false}
        >
          <div
            onInputCapture={() => {
              formDirty.current = true
            }}
            onChangeCapture={() => {
              formDirty.current = true
            }}
          >
            <FinanceForm
              key={form.item?.id ?? "new"}
              item={form.item}
              today={today}
              busy={finance.busy}
              error={finance.error}
              onSave={save}
              onCancel={closeForm}
            />
          </div>
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir movimento"
          message={`O movimento "${deleting.titulo}" será excluído e o saldo será recalculado.`}
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
