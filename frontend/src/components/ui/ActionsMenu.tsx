import React, { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal } from "lucide-react"
import Button from "./Button"

type MenuItem = {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}
export default function ActionsMenu({
  label,
  items,
  disabled = false,
}: {
  label: string
  items: MenuItem[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  function close(restore = false) {
    setOpen(false)
    if (restore) trigger.current?.focus()
  }
  function show() {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const height = Math.min(
      items.length * 44 + items.filter((item) => item.separatorBefore).length * 9 + 16,
      window.innerHeight - 24
    )
    setPosition({
      left: Math.max(12, Math.min(rect.right - 240, window.innerWidth - 252)),
      top:
        rect.bottom + height < window.innerHeight - 12
          ? rect.bottom + 6
          : Math.max(12, rect.top - height - 6),
    })
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    function outside(event: PointerEvent) {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false)
    }
    function dismiss() {
      setOpen(false)
    }
    function scrollOutside(event: Event) {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("scroll", scrollOutside, true)
    window.addEventListener("resize", dismiss)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("scroll", scrollOutside, true)
      window.removeEventListener("resize", dismiss)
    }
  }, [open])
  return (
    <>
      <Button
        ref={trigger}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        size="icon"
        variant="ghost"
        onClick={() => (open ? close(true) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            show()
          }
        }}
      >
        <MoreHorizontal size={20} aria-hidden="true" />
      </Button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            style={position}
            className="fixed z-50 max-h-[calc(100dvh-24px)] w-60 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-surface-overlay p-2 text-text-primary shadow-overlay"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) close()
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                close(true)
                return
              }
              const buttons = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []
              )
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              let next = index
              if (event.key === "ArrowDown") next = (index + 1) % buttons.length
              else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length
              else if (event.key === "Home") next = 0
              else if (event.key === "End") next = buttons.length - 1
              else return
              event.preventDefault()
              buttons[next]?.focus()
            }}
          >
            {items.map((item) => (
              <React.Fragment key={item.label}>
                {item.separatorBefore && (
                  <div role="separator" className="my-1 border-t border-border" />
                )}
                <button
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  className={`flex min-h-11 w-full items-center rounded-control border-0 bg-transparent px-3 text-left text-sm disabled:opacity-50 ${item.danger ? "text-danger hover:bg-danger-soft" : "text-text-primary hover:bg-surface-subtle"}`}
                  onClick={() => {
                    close(true)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
