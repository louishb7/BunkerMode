import React, { useRef, useState } from "react"
import Dialog from "../../../components/ui/Dialog"
import Button from "../../../components/ui/Button"
import { AchievementCrown } from "./ObjectiveMap"
import { displayDate } from "../objectiveMapModel"

export default function ConquerObjectiveDialog({
  objetivo,
  timezone,
  onClose,
  onConquer,
  onOpenMemory,
  saving,
  error,
}) {
  const [note, setNote] = useState("")
  const [achievement, setAchievement] = useState(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      className="conquer-dialog"
      title={achievement ? "Coroa conquistada" : "Você conquistou este objetivo?"}
      onClose={saving ? undefined : onClose}
      closeOnEscape={!saving}
      initialFocusRef={cancelRef}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          const result = await onConquer(note)
          if (result) setAchievement(result)
        }}
      >
        <div className={`conquer-symbol ${achievement ? "is-celebrating" : ""}`}>
          {achievement && (
            <svg aria-hidden="true" className="conquer-rays" viewBox="0 0 240 100">
              <path
                d="M 10 90 Q 60 90 120 24 M 230 90 Q 180 90 120 24 M 120 100 L 120 24"
                pathLength="1"
              />
            </svg>
          )}
          <AchievementCrown achieved={Boolean(achievement)} />
        </div>
        <h3>{achievement?.snapshot.titulo ?? objetivo.titulo}</h3>
        <dl className="conquer-dates">
          <div>
            <dt>Criado em</dt>
            <dd>{displayDate(objetivo.created_at, timezone)}</dd>
          </div>
          <div>
            <dt>{achievement ? "Conquistado em" : "Conquista"}</dt>
            <dd>
              {displayDate(achievement?.conquistado_em ?? new Date().toISOString(), timezone)}
            </dd>
          </div>
        </dl>
        {!achievement && (
          <label className="conquer-note">
            O que essa conquista significou para você? <span>Opcional</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={note}
              disabled={saving}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Uma lembrança para voltar no futuro…"
            />
          </label>
        )}
        {achievement ? (
          <>
            <p className="conquer-saved" role="status">
              Seu objetivo e seus vínculos ficaram guardados nesta memória.
            </p>
            <Button variant="secondary" onClick={() => onOpenMemory(achievement)}>
              Ver conquista
            </Button>
          </>
        ) : (
          <>
            {error && (
              <p className="text-danger text-sm" role="alert">
                {error}
              </p>
            )}
            <div className="conquer-actions">
              <Button ref={cancelRef} variant="ghost" disabled={saving} onClick={onClose}>
                Ainda não
              </Button>
              <Button type="submit" variant="secondary" loading={saving}>
                Conquistei
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  )
}
