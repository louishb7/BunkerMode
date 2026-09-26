import React, { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Plus, Wallet } from "lucide-react"
import { Link } from "react-router-dom"
import Button from "../../../components/ui/Button"
import PageHeader from "../../../components/ui/PageHeader"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Dialog from "../../../components/ui/Dialog"
import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import LoadingLines from "../../../components/ui/LoadingLines"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import { operationalDateFor } from "../../calendar/calendarUtils"
import { formatDateForApi } from "../../../utils/date"
import { useObjectives } from "../../objectives/hooks/useObjectives"
import { useFinances } from "../hooks/useFinances"
import { money, reserveSignal } from "../money"
import FinanceForm from "../components/FinanceForm"

export default function FinancesPage({ token, user, onUnauthorized }) {
  const today = formatDateForApi(operationalDateFor(user?.timezone)).split("-").reverse().join("-")
  const [month, setMonth] = useState(today.slice(0, 7))
  const finance = useFinances({ token, onUnauthorized, month })
  const objectivesEnabled = getEnabledModules(user).some((m) => m.key === "objectives")
  const objectives = useObjectives({ token, onUnauthorized, enabled: objectivesEnabled })
  const [form, setForm] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const data = finance.data
  const open = (kind, item = null) => setForm({ kind, item })
  async function save(payload, id) {
    // Um módulo desativado não remove um vínculo já existente durante uma edição.
    if (form.kind === "reserve" && !objectivesEnabled && form.item)
      payload.objetivo_id = form.item.objetivo_id
    if (
      await (form.kind === "reserve"
        ? finance.saveReserve(payload, id)
        : finance.saveEntry(payload, id))
    )
      setForm(null)
  }
  return (
    <section className="finance-page grid gap-7">
      <PageHeader
        title="Finanças"
        description="Recursos para sustentar suas escolhas."
        actions={
          <Button onClick={() => open("entry")}>
            <Plus size={17} />
            Novo lançamento
          </Button>
        }
      />
      {finance.error && !form && !deleting && (
        <div role="alert" className="text-sm text-danger">
          {finance.error}{" "}
          <Button variant="ghost" onClick={finance.refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!data ? (
        finance.loading ? (
          <LoadingLines label="Carregando finanças" />
        ) : null
      ) : (
        <>
          <section aria-label="Recursos registrados" className="finance-resources">
            <div>
              <p className="eyebrow">Livre após reservas</p>
              <p className={`finance-main-value ${data.livre_centavos < 0 ? "text-danger" : ""}`}>
                {money(data.livre_centavos)}
              </p>
              <p className="m-0 text-xs text-text-secondary">
                Saldo registrado, sem previsão de entradas futuras.
              </p>
            </div>
            <dl className="m-0 grid gap-5">
              <div>
                <dt>Saldo registrado</dt>
                <dd>{money(data.saldo_centavos)}</dd>
              </div>
              <div>
                <dt>Separado em reservas</dt>
                <dd>{money(data.reservado_centavos)}</dd>
              </div>
            </dl>
          </section>
          {data.livre_centavos < 0 && (
            <p role="status" className="m-0 border-l-2 border-danger pl-4 text-sm text-danger">
              Faltam {money(-data.livre_centavos)} para cobrir o saldo reservado. Revise os
              lançamentos ou reduza suas reservas.
            </p>
          )}
          <section aria-labelledby="reserve-title">
            <header className="section-heading">
              <div>
                <p className="eyebrow">Destinação</p>
                <h2 id="reserve-title">Reservas</h2>
              </div>
              <Button variant="ghost" onClick={() => open("reserve")}>
                <Plus size={16} />
                Nova reserva
              </Button>
            </header>
            {!data.reservas.length ? (
              <p className="empty-copy">
                Separe recursos para uma finalidade, com ou sem um objetivo.
              </p>
            ) : (
              <div className="reserve-list">
                {data.reservas.map((reserve) => {
                  const goal = objectivesEnabled
                    ? objectives.objetivos.find((o) => o.id === reserve.objetivo_id)
                    : null
                  return (
                    <article key={reserve.id} id={`reserva-${reserve.id}`} className="reserve-row">
                      <Wallet size={19} className="mt-1 text-accent" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="m-0 break-words text-base font-semibold">
                          {reserve.titulo}
                        </h3>
                        <p className="mt-2 mb-0 text-sm tabular-nums">{reserveSignal(reserve)}</p>
                        {goal && (
                          <Link
                            className="inline-block min-h-8 pt-1 text-xs text-text-secondary"
                            to={`/objetivos#objetivo-${goal.id}`}
                          >
                            {goal.titulo}
                          </Link>
                        )}
                      </div>
                      <ActionsMenu
                        label={`Ações da reserva: ${reserve.titulo}`}
                        disabled={finance.busy}
                        items={[
                          { label: "Editar reserva", onSelect: () => open("reserve", reserve) },
                          ...(reserve.objetivo_id !== null && objectivesEnabled
                            ? [
                                {
                                  label: "Desvincular do objetivo",
                                  onSelect: () =>
                                    finance.saveReserve({ objetivo_id: null }, reserve.id),
                                },
                              ]
                            : []),
                          {
                            label: "Excluir reserva",
                            onSelect: () => setDeleting({ kind: "reserve", item: reserve }),
                            danger: true,
                          },
                        ]}
                      />
                    </article>
                  )
                })}
              </div>
            )}
          </section>
          <section aria-labelledby="movements-title">
            <header className="section-heading">
              <div>
                <p className="eyebrow">Fluxo realizado</p>
                <h2 id="movements-title">Movimentações</h2>
              </div>
              <label className="form-label text-xs">
                Período
                <input
                  aria-label="Período"
                  className="form-field"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value)
                  }}
                />
              </label>
            </header>
            <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-border py-4 text-sm">
              <span>
                Receitas{" "}
                <strong className="ml-2 tabular-nums">{money(data.receitas_centavos)}</strong>
              </span>
              <span>
                Despesas{" "}
                <strong className="ml-2 tabular-nums">{money(data.despesas_centavos)}</strong>
              </span>
            </div>
            {!data.lancamentos.length ? (
              <div className="empty-copy">
                <p>Nenhuma movimentação neste mês.</p>
                <p className="text-xs">
                  Comece pelo saldo inicial e registre as entradas e saídas a partir dele.
                </p>
              </div>
            ) : (
              <ol className="m-0 list-none p-0">
                {data.lancamentos.map((entry) => {
                  const incoming = entry.tipo === "receita" || entry.tipo === "ajuste_entrada"
                  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
                  return (
                    <li key={entry.id} className="ledger-row">
                      <Icon size={17} className="mt-1 text-text-muted" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="m-0 break-words text-sm font-medium">{entry.titulo}</p>
                        <p className="mt-1 mb-0 text-xs text-text-secondary">
                          {entry.data.split("-").reverse().join("/")} · {entry.categoria}
                          {entry.tipo.startsWith("ajuste") ? " de saldo" : ""}
                        </p>
                      </div>
                      <span className="ledger-amount">
                        {incoming ? "+" : "−"} {money(entry.valor_centavos)}
                      </span>
                      <ActionsMenu
                        label={`Ações do lançamento: ${entry.titulo}`}
                        disabled={finance.busy}
                        items={[
                          { label: "Editar lançamento", onSelect: () => open("entry", entry) },
                          {
                            label: "Excluir lançamento",
                            onSelect: () => setDeleting({ kind: "entry", item: entry }),
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
          title={
            form.kind === "reserve"
              ? form.item
                ? "Editar reserva"
                : "Nova reserva"
              : form.item
                ? "Editar lançamento"
                : "Novo lançamento"
          }
          onClose={() => setForm(null)}
          closeOnBackdrop={false}
        >
          <FinanceForm
            key={`${form.kind}-${form.item?.id ?? "new"}`}
            kind={form.kind}
            item={form.item}
            objectives={objectivesEnabled ? objectives.objetivos : []}
            today={today}
            busy={finance.busy}
            error={
              finance.error ||
              (objectivesEnabled && objectives.status.type === "error"
                ? "Objetivos indisponíveis. Tente novamente antes de alterar o vínculo."
                : "")
            }
            onSave={save}
            onCancel={() => setForm(null)}
          />
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.kind === "reserve" ? "Excluir reserva" : "Excluir lançamento"}
          message={
            deleting.kind === "reserve"
              ? `A reserva "${deleting.item.titulo}" será removida. O saldo e os lançamentos serão preservados; o valor ficará livre.`
              : `O lançamento "${deleting.item.titulo}" será excluído e o saldo será recalculado.`
          }
          confirmLabel="Excluir"
          error={finance.error}
          loading={finance.busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (
              await (deleting.kind === "reserve"
                ? finance.deleteReserve(deleting.item.id)
                : finance.deleteEntry(deleting.item.id))
            )
              setDeleting(null)
          }}
        />
      )}
    </section>
  )
}
