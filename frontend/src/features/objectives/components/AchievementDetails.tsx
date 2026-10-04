import React, { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import Button from "../../../components/ui/Button"
import ObjectiveMap, { AchievementCrown } from "./ObjectiveMap"
import ObjectiveNodeDetails from "./ObjectiveNodeDetails"
import { displayDate, elapsedDays, nodeFact } from "../objectiveMapModel"

export default function AchievementDetails({ achievement, onBack }) {
  const [showMap, setShowMap] = useState(false)
  const [selected, setSelected] = useState(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  const closeDetails = useCallback(() => setSelected(null), [])
  const snapshot = achievement.snapshot
  const timezone = snapshot.fuso_horario
  const now = new Date(achievement.conquistado_em ?? snapshot.criado_em)
  const days =
    achievement.conquistado_em && !snapshot.historico_incompleto
      ? elapsedDays(snapshot.criado_em, now, timezone)
      : null
  return (
    <article className="achievement-memory" aria-label={`Memória: ${snapshot.titulo}`}>
      <Button variant="ghost" className="memory-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Conquistas
      </Button>
      <header className="memory-heading">
        <AchievementCrown achieved />
        <p className="eyebrow">Uma direção que virou memória</p>
        <h2 ref={headingRef} tabIndex={-1}>
          {snapshot.titulo}
        </h2>
        {days !== null && (
          <p className="memory-duration">
            {days} {days === 1 ? "dia entre criação e conquista" : "dias entre criação e conquista"}
          </p>
        )}
        <p className="memory-dates">
          <time dateTime={snapshot.criado_em}>{displayDate(snapshot.criado_em, timezone)}</time>
          <span aria-label="até">→</span>
          <time dateTime={achievement.conquistado_em ?? undefined}>
            {displayDate(achievement.conquistado_em, timezone)}
          </time>
        </p>
        {achievement.nota && <blockquote>{achievement.nota}</blockquote>}
      </header>
      {snapshot.historico_incompleto && (
        <p className="memory-legacy" role="note">
          Este objetivo foi concluído antes das memórias de conquista. O título e o propósito
          disponíveis foram preservados na migração; seus vínculos históricos não foram registrados.
        </p>
      )}
      {snapshot.nos.length > 0 && (
        <section className="memory-facts" aria-label="Vínculos no momento da conquista">
          <h3>O que estava conectado a esta direção</h3>
          <ul>
            {snapshot.nos.map((node) => (
              <li key={node.id}>
                <span>
                  {node.tipo === "rotina"
                    ? "Tarefa recorrente"
                    : node.tipo === "tarefa"
                      ? "Tarefa"
                      : "Acompanhamento"}
                </span>
                <strong>{node.titulo}</strong>
                <p>
                  {node.tipo === "rotina"
                    ? `${node.realizadas ?? 0} ocorrências concluídas · ${nodeFact(node, timezone, now)}`
                    : nodeFact(node, timezone, now)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Button
        variant="secondary"
        aria-expanded={showMap}
        aria-controls="achievement-final-map"
        onClick={() => setShowMap(!showMap)}
      >
        {showMap ? "Recolher mapa final" : "Ver mapa final"}
      </Button>
      {showMap && (
        <section
          id="achievement-final-map"
          className="memory-final-map"
          aria-label="Mapa histórico da conquista"
        >
          <p className="eyebrow">
            Mapa final · {displayDate(achievement.conquistado_em, timezone)}
          </p>
          <ObjectiveMap
            title={snapshot.titulo}
            purpose={snapshot.proposito}
            nodes={snapshot.nos}
            timezone={timezone}
            now={now}
            achieved
            onSelect={setSelected}
            emptyMessage={
              snapshot.historico_incompleto
                ? "Os vínculos desta conquista não foram registrados."
                : "Este objetivo foi conquistado sem vínculos."
            }
          />
        </section>
      )}
      {selected && (
        <ObjectiveNodeDetails
          node={selected}
          timezone={timezone}
          now={now}
          readOnly
          onClose={closeDetails}
        />
      )}
    </article>
  )
}
