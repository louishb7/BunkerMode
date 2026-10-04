import React, { useId, useLayoutEffect, useRef, useState } from "react"
import { Check, Crown, Minus, Repeat2 } from "lucide-react"
import type { ObjectiveMapNode } from "../../../types/achievementContract"
import { elapsedDays, nodeFact } from "../objectiveMapModel"

const groups = [
  { tipo: "rotina", label: "Tarefas recorrentes" },
  { tipo: "tarefa", label: "Tarefas" },
  { tipo: "acompanhamento", label: "Acompanhamentos" },
] as const

export function AchievementCrown({ achieved = false, className = "" }) {
  return (
    <Crown
      aria-hidden="true"
      className={`objective-crown ${achieved ? "is-achieved" : ""} ${className}`}
      strokeWidth={1.25}
    />
  )
}

function NodeMark({ node, timezone, now }) {
  if (node.tipo === "acompanhamento") {
    const days = node.ultima_ocorrencia ? elapsedDays(node.ultima_ocorrencia, now, timezone) : null
    return (
      <span className="map-occurrence-mark" aria-hidden="true">
        <span>
          {days === null ? "—" : days}
          <small>{days === null ? "" : "d"}</small>
        </span>
      </span>
    )
  }
  return (
    <span
      className={`map-task-mark ${node.estado === "CONCLUIDA" ? "is-complete" : ""} ${node.tipo === "rotina" ? "is-routine" : ""}`}
      aria-hidden="true"
    >
      {node.estado === "CONCLUIDA" ? (
        <Check size={16} />
      ) : node.estado === "NAO_REALIZADA" ? (
        <Minus size={14} />
      ) : node.tipo === "rotina" ? (
        <Repeat2 size={15} />
      ) : null}
    </span>
  )
}

type Connection = { id: string; path: string; active: boolean; descendants?: string[] }
function ObjectiveConnections({ canvasRef, layoutKey, pulseId }) {
  const [connections, setConnections] = useState<Connection[]>([])
  useLayoutEffect(() => {
    const canvas = canvasRef.current as HTMLElement | null
    if (!canvas) return
    function measure() {
      const bounds = canvas!.getBoundingClientRect()
      const root = canvas!.querySelector<HTMLElement>("[data-map-root]")
      if (!root || !bounds.width) return
      const point = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.left + rect.width / 2 - bounds.left,
          y: rect.top + rect.height / 2 - bounds.top,
        }
      }
      const origin = point(root)
      const next: Connection[] = []
      for (const group of canvas!.querySelectorAll<HTMLElement>("[data-map-group]")) {
        const anchor = group.querySelector<HTMLElement>("[data-map-group-anchor]")!
        const station = point(anchor)
        const vertical = bounds.width <= 600
        const middle = origin.y + (station.y - origin.y) / 2
        const nodes = [...group.querySelectorAll<HTMLElement>("[data-map-node]")]
        const recent = nodes.some((node) => node.dataset.recent === "true")
        next.push({
          id: group.dataset.mapGroup!,
          active: recent,
          descendants: nodes.map((node) => node.dataset.mapNode!),
          path: vertical
            ? `M ${origin.x} ${origin.y} L ${origin.x} ${station.y} L ${station.x} ${station.y}`
            : `M ${origin.x} ${origin.y} C ${origin.x} ${middle}, ${station.x} ${middle}, ${station.x} ${station.y}`,
        })
        for (const node of nodes) {
          const target = point(node.querySelector<HTMLElement>("[data-map-node-anchor]")!)
          next.push({
            id: node.dataset.mapNode!,
            active: node.dataset.recent === "true",
            path: `M ${station.x} ${station.y} L ${station.x} ${target.y - 10} Q ${station.x} ${target.y}, ${station.x + 10} ${target.y} L ${target.x} ${target.y}`,
          })
        }
      }
      setConnections(next)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(canvas)
    for (const element of canvas.querySelectorAll<HTMLElement>(
      "[data-map-group], [data-map-node], .map-root"
    ))
      observer?.observe(element)
    window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [canvasRef, layoutKey])
  return (
    <svg className="map-connections" aria-hidden="true" focusable="false">
      {connections.map((connection) => (
        <React.Fragment key={connection.id}>
          <path
            d={connection.path}
            className={connection.active ? "map-line is-recent" : "map-line"}
          />
          {pulseId &&
            (pulseId.id === connection.id ||
              connection.descendants?.includes(pulseId.id) ||
              pulseId.id === "achievement") && (
              <path
                key={`${connection.id}-${pulseId.key}`}
                d={connection.path}
                pathLength="1"
                className={`map-event-pulse ${pulseId.id === "achievement" ? "is-converging" : ""}`}
              />
            )}
        </React.Fragment>
      ))}
    </svg>
  )
}

type MapProps = {
  title: string
  purpose?: string | null
  nodes: ObjectiveMapNode[]
  timezone?: string
  now?: Date
  achieved?: boolean
  onSelect?: (node: ObjectiveMapNode) => void
  rootActions?: React.ReactNode
  rootMeta?: React.ReactNode
  pulseId?: { id: string; key: number } | null
  emptyMessage?: string | null
}
export default function ObjectiveMap({
  title,
  purpose,
  nodes,
  timezone,
  now = new Date(),
  achieved = false,
  onSelect,
  rootActions = null,
  rootMeta = null,
  pulseId = null,
  emptyMessage = "Esta direção começa com você. Adicione vínculos quando fizer sentido.",
}: MapProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const id = useId()
  const populated = groups
    .map((group) => ({ ...group, nodes: nodes.filter((node) => node.tipo === group.tipo) }))
    .filter((group) => group.nodes.length)
  const layoutKey = JSON.stringify([
    nodes,
    expanded,
    title,
    purpose,
    timezone,
    now.toISOString().slice(0, 10),
  ])
  return (
    <div
      className="objective-canvas"
      ref={canvasRef}
      role="group"
      aria-label={`Mapa do objetivo: ${title}`}
    >
      <ObjectiveConnections canvasRef={canvasRef} layoutKey={layoutKey} pulseId={pulseId} />
      <header className="map-root">
        <AchievementCrown achieved={achieved} />
        <span className="sr-only">
          {achieved ? "Coroa conquistada" : "Coroa ainda por conquistar"}
        </span>
        {rootMeta}
        <h2>{title}</h2>
        {purpose && <p className="map-purpose">{purpose}</p>}
        {rootActions}
        <span className="map-root-anchor" data-map-root aria-hidden="true" />
      </header>
      {populated.length ? (
        <div
          className="map-groups"
          style={{ "--map-group-count": populated.length } as React.CSSProperties}
        >
          {populated.map((group) => (
            <section
              key={group.tipo}
              className="map-group"
              data-map-group={group.tipo}
              aria-labelledby={`${id}-${group.tipo}`}
            >
              <h3 id={`${id}-${group.tipo}`}>
                <span className="map-station" data-map-group-anchor aria-hidden="true" />
                {group.label}
                <small>{group.nodes.length}</small>
              </h3>
              <ul id={`${id}-${group.tipo}-nodes`} className="map-node-list">
                {(expanded[group.tipo] ? group.nodes : group.nodes.slice(0, 4)).map((node) => {
                  const fact = nodeFact(node, timezone, now)
                  const activity =
                    node.tipo === "acompanhamento" ? node.ultima_ocorrencia : node.atividade_em
                  const recent = activity && elapsedDays(activity, now, timezone) === 0
                  return (
                    <li key={node.id} data-map-node={node.id} data-recent={Boolean(recent)}>
                      <button
                        className="map-node"
                        type="button"
                        onClick={() => onSelect?.(node)}
                        aria-label={`${node.titulo}, ${fact}${node.tipo === "rotina" && node.estado === "CONCLUIDA" ? ", ocorrência concluída" : ""}. Abrir detalhes.`}
                      >
                        <span className="map-node-anchor" data-map-node-anchor>
                          <NodeMark node={node} timezone={timezone} now={now} />
                        </span>
                        <span className="map-node-copy">
                          <strong>{node.titulo}</strong>
                          <span>{fact}</span>
                          {node.syncStatus && <small>Registro pendente de sincronização</small>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {group.nodes.length > 4 && (
                <button
                  className="map-expand"
                  type="button"
                  aria-expanded={Boolean(expanded[group.tipo])}
                  aria-controls={`${id}-${group.tipo}-nodes`}
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [group.tipo]: !current[group.tipo] }))
                  }
                >
                  {expanded[group.tipo] ? "Recolher" : `+${group.nodes.length - 4} · Mostrar mais`}
                </button>
              )}
            </section>
          ))}
        </div>
      ) : (
        emptyMessage && <p className="map-empty">{emptyMessage}</p>
      )}
    </div>
  )
}
