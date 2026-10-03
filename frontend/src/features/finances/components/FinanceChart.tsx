import React, { useState } from "react"
import type { FinanceOverview } from "../../../types/financeContract"
import { money } from "../money"

type Point = FinanceOverview["serie_diaria"][number]
const dateLabel = (date: string) => date.slice(5).split("-").reverse().join("/")

export default function FinanceChart({ points, today }: { points: Point[]; today: string }) {
  // Não desenhar dias futuros como se fossem resultados já realizados.
  const days = points.filter((point) => point.data <= today)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const hasMovements = days.some(
    (point) =>
      point.receitas_centavos > 0 || point.despesas_centavos > 0 || point.resultado_centavos !== 0
  )
  const selectedIndex = Math.max(
    0,
    selectedDate === null ? days.length - 1 : days.findIndex((point) => point.data === selectedDate)
  )
  const selected = days[selectedIndex]
  const previous = days[selectedIndex - 1]
  const values = days.map((point) => point.resultado_centavos)
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values)
  const roughStep = Math.max(1, (max - min) / 4)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= roughStep) * magnitude
  const bottom = Math.floor(min / step) * step
  const top = Math.max(bottom + step, Math.ceil(max / step) * step)
  const ticks = Array.from(
    { length: Math.round((top - bottom) / step) + 1 },
    (_, i) => bottom + i * step
  )
  const y = (value: number) => 8 + (1 - (value - bottom) / (top - bottom)) * 160
  const x = (index: number) => 8 + (index / Math.max(1, days.length - 1)) * 584
  const path = days
    .map((point, i) => `${i ? "L" : "M"}${x(i)} ${y(point.resultado_centavos)}`)
    .join(" ")
  const dailyValue = (key: "receitas_centavos" | "despesas_centavos") =>
    selected?.[key] === undefined ? "—" : money(selected[key] - (previous?.[key] ?? 0))
  function selectAtPointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const position = (((event.clientX - rect.left) / rect.width) * 600 - 8) / 584
    const index = Math.min(days.length - 1, Math.max(0, Math.round(position * (days.length - 1))))
    setSelectedDate(days[index].data)
  }

  return (
    <section className="finance-chart" aria-label="Evolução no mês">
      <div className="finance-chart-heading">
        <h2>Evolução no mês</h2>
        <span>Resultado acumulado · R$</span>
      </div>
      {!hasMovements ? (
        <p className="empty-copy">Ainda não há entradas ou saídas para mostrar.</p>
      ) : (
        <>
          <p className="finance-chart-total">
            <strong>{money(days.at(-1).resultado_centavos)}</strong>
            <span>Entradas menos saídas até {dateLabel(days.at(-1).data)}</span>
          </p>
          <div className="finance-chart-plot">
            <div
              className="finance-chart-axis"
              aria-hidden="true"
              style={{ width: `${Math.max(...ticks.map((tick) => money(tick).length))}ch` }}
            >
              {ticks.map((tick) => (
                <span key={tick} style={{ top: `${(y(tick) / 176) * 100}%` }}>
                  {money(tick)}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <svg
                role="img"
                aria-label="Resultado acumulado: entradas menos saídas ao longo do mês"
                viewBox="0 0 600 176"
                preserveAspectRatio="none"
                onPointerDown={selectAtPointer}
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse") selectAtPointer(event)
                }}
              >
                {ticks.map((tick) => (
                  <line
                    key={tick}
                    x1="0"
                    x2="600"
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke={tick === 0 ? "var(--color-border-strong)" : "var(--color-border)"}
                    strokeDasharray={tick === 0 ? undefined : "3 5"}
                  />
                ))}
                <path
                  d={path}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={x(selectedIndex)}
                  x2={x(selectedIndex)}
                  y1="8"
                  y2="168"
                  stroke="var(--color-text-muted)"
                  strokeDasharray="3 5"
                />
                <circle
                  cx={x(selectedIndex)}
                  cy={y(selected.resultado_centavos)}
                  r="4"
                  fill="var(--color-accent)"
                />
              </svg>
              <div className="finance-chart-dates" aria-hidden="true">
                <span>{dateLabel(days[0].data)}</span>
                {days.length > 2 && (
                  <span>{dateLabel(days[Math.floor((days.length - 1) / 2)].data)}</span>
                )}
                {days.length > 1 && <span>{dateLabel(days.at(-1).data)}</span>}
              </div>
            </div>
          </div>
          <label className="finance-chart-day">
            <span>
              Consultar dia <strong>{dateLabel(selected.data)}</strong>
            </span>
            <input
              type="range"
              aria-label="Dia do gráfico"
              min="0"
              max={days.length - 1}
              value={selectedIndex}
              disabled={days.length === 1}
              aria-valuetext={selected.data.split("-").reverse().join("/")}
              onChange={(event) => setSelectedDate(days[Number(event.target.value)].data)}
            />
          </label>
          <dl className="finance-chart-details" aria-live="polite">
            <div>
              <dt>Entradas no dia</dt>
              <dd className="chart-income">{dailyValue("receitas_centavos")}</dd>
            </div>
            <div>
              <dt>Saídas no dia</dt>
              <dd className="chart-expense">{dailyValue("despesas_centavos")}</dd>
            </div>
            <div>
              <dt>Resultado até o dia</dt>
              <dd>{money(selected.resultado_centavos)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  )
}
