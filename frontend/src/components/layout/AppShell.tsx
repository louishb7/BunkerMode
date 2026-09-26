import React, { useEffect, useRef, useState } from "react"
import { Wallet, Home, ListTodo, Compass, Settings, LogOut, Menu, X } from "lucide-react"
import Brand from "../ui/Brand"
import { NavLink } from "react-router-dom"

import Button from "../ui/Button"
import { getEnabledModules } from "../../modules/moduleCatalog"
import { APP_ROUTES } from "../../routes/routeConstants"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

function NavigationLinks({ onNavigate = undefined, user }) {
  const items = [
    { key: "home", label: "Início", route: APP_ROUTES.ROOT },
    ...getEnabledModules(user),
  ]
  const icons = { home: Home, tasks: ListTodo, objectives: Compass, finances: Wallet }
  return (
    <nav aria-label="Navegação principal" className="grid gap-2">
      {items.map((item) => {
        const Icon = icons[item.key]
        return (
          <NavLink
            key={item.key}
            to={item.route}
            end={item.route === APP_ROUTES.ROOT}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm no-underline transition-colors motion-reduce:transition-none ${isActive ? "bg-surface font-semibold text-text-primary shadow-surface ring-1 ring-border" : "font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary"}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={19} aria-hidden="true" className={isActive ? "text-accent" : ""} />
                {item.label}
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SessionActions({ onLogout, onNavigate = undefined, user }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 p-2">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full bg-peripheral text-sm font-semibold text-text-primary"
        aria-hidden="true"
      >
        {(user?.usuario || "U").slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
        {user?.usuario || "Usuário"}
      </span>
      <NavLink
        to={APP_ROUTES.SETTINGS}
        onClick={onNavigate}
        aria-label="Configurações"
        title="Configurações"
        className={({ isActive }) =>
          `inline-flex size-11 shrink-0 items-center justify-center rounded-control ${isActive ? "bg-selection text-accent" : "text-text-secondary hover:bg-surface-subtle"}`
        }
      >
        <Settings size={18} aria-hidden="true" />
      </NavLink>
      <Button aria-label="Sair" title="Sair" size="icon" variant="ghost" onClick={onLogout}>
        <LogOut size={18} aria-hidden="true" />
      </Button>
    </div>
  )
}

export default function AppShell({ children, onLogout, user }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const mobilePanelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!menuOpen) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()
    const desktop = window.matchMedia("(min-width: 1024px)")
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setMenuOpen(false)
    }
    desktop.addEventListener("change", closeOnDesktop)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }

      if (event.key !== "Tab") {
        return
      }

      const focusableElements = Array.from(
        mobilePanelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) || []
      )
      if (focusableElements.length === 0) {
        event.preventDefault()
        mobilePanelRef.current?.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      desktop.removeEventListener("change", closeOnDesktop)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }

  return (
    <div className="min-h-dvh bg-canvas text-text-primary lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-peripheral lg:flex">
        <div className="flex min-h-24 items-center px-5">
          <Brand />
        </div>
        <div className="px-4 py-4">
          <NavigationLinks user={user} />
        </div>
        <div className="mt-auto px-3 pb-4">
          <SessionActions onLogout={onLogout} onNavigate={closeMenu} user={user} />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-border bg-peripheral px-4 lg:hidden">
        <Brand compact />
        <Button
          ref={menuButtonRef}
          aria-controls="mobile-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          size="icon"
          variant="ghost"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <Menu size={20} aria-hidden="true" />
        </Button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-backdrop lg:hidden" onMouseDown={closeMenu}>
          <aside
            ref={mobilePanelRef}
            aria-label="Navegação"
            aria-modal="true"
            className="grid h-full w-[min(304px,calc(100vw-2rem))] grid-rows-[auto_1fr_auto] border-r border-border bg-peripheral shadow-overlay"
            id="mobile-navigation"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5">
              <Brand compact />
              <Button
                ref={closeButtonRef}
                aria-label="Fechar menu"
                size="icon"
                variant="ghost"
                onClick={closeMenu}
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </div>
            <div className="overflow-y-auto px-4 py-4">
              <NavigationLinks onNavigate={closeMenu} user={user} />
            </div>
            <div className="px-5 pb-6">
              <SessionActions onLogout={onLogout} onNavigate={closeMenu} user={user} />
            </div>
          </aside>
        </div>
      )}

      <main className="min-h-[calc(100dvh-4rem)] min-w-0 bg-canvas px-4 py-6 sm:px-7 sm:py-8 lg:min-h-dvh lg:px-8 lg:py-9">
        <div className="mx-auto w-full max-w-[960px]">{children}</div>
      </main>
    </div>
  )
}
