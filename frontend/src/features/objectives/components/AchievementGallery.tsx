import React from "react"
import { AchievementCrown } from "./ObjectiveMap"
import { displayDate } from "../objectiveMapModel"
import LoadingLines from "../../../components/ui/LoadingLines"
import Button from "../../../components/ui/Button"

export default function AchievementGallery({
  achievements,
  onSelect,
  loading,
  error,
  onRetry,
  timezone,
}) {
  return (
    <section className="achievement-gallery" aria-label="Conquistas">
      <p className="achievement-intro">
        Uma coroa para cada objetivo que você declarou conquistado.
      </p>
      {loading && !achievements.length && <LoadingLines label="Carregando conquistas" />}
      {error && (
        <p role="status" className="text-danger text-sm">
          {error}{" "}
          <Button variant="ghost" onClick={onRetry}>
            Tentar novamente
          </Button>
        </p>
      )}
      {!loading && !error && !achievements.length && (
        <div className="achievement-empty">
          <AchievementCrown />
          <h2>Sua primeira coroa ainda está por vir.</h2>
          <p>Quando alcançar um objetivo, declare sua conquista. A memória ficará aqui.</p>
        </div>
      )}
      <ul className="achievement-collection">
        {achievements.map((achievement) => (
          <li key={achievement.id}>
            <button
              type="button"
              className="achievement-object"
              onClick={() => onSelect(achievement)}
              aria-label={`${achievement.snapshot.titulo}, conquistado em ${displayDate(achievement.conquistado_em, timezone)}. Abrir memória.`}
            >
              <AchievementCrown achieved />
              <strong>{achievement.snapshot.titulo}</strong>
              <time dateTime={achievement.conquistado_em ?? undefined}>
                {displayDate(achievement.conquistado_em, timezone)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
