import React from "react"

export default function PageHeader({ actions = undefined, description = undefined, title }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-semibold leading-tight tracking-tight text-text-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 mb-0 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
