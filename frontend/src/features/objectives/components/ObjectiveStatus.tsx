import React from "react"
import { Circle, Pause, Check, Archive } from "lucide-react"

const states = {
  ativo: { label: "Ativo", Icon: Circle, tone: "text-accent" },
  pausado: { label: "Pausado", Icon: Pause, tone: "text-text-secondary" },
  concluido: { label: "Concluído", Icon: Check, tone: "text-success" },
  abandonado: { label: "Abandonado", Icon: Archive, tone: "text-text-muted" },
}

export default function ObjectiveStatus({ status }) {
  const { label, Icon, tone } = states[status] || {
    label: status,
    Icon: Circle,
    tone: "text-text-secondary",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  )
}
