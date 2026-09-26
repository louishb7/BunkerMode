import React from "react"
export default function LoadingLines({ label = "Carregando" }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3 py-6">
      <span className="skeleton-line w-2/3" />
      <span className="skeleton-line w-full" />
      <span className="skeleton-line w-1/2" />
    </div>
  )
}
