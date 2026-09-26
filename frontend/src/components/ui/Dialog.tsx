import React, { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

function getFocusableElements(container: HTMLElement | null) {
  return (Array.from(container?.querySelectorAll(focusableSelector) || []) as HTMLElement[]).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true"
  )
}

type DialogProps = {
  ariaLabel?: string
  children: React.ReactNode
  className?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  describedBy?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
  onClose?: () => void
  title?: React.ReactNode
}

export default function Dialog({
  ariaLabel,
  children,
  className = "",
  closeOnBackdrop = false,
  closeOnEscape = true,
  describedBy,
  initialFocusRef,
  onClose,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusInitialElement = () => {
      const initialElement = initialFocusRef?.current
      const [firstFocusableElement] = getFocusableElements(dialogRef.current)
      ;(initialElement || firstFocusableElement || dialogRef.current)?.focus()
    }

    const timeoutId = window.setTimeout(focusInitialElement, 0)

    function handleKeyDown(event) {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault()
        onClose?.()
        return
      }

      if (event.key !== "Tab") {
        return
      }

      const focusableElements = getFocusableElements(dialogRef.current)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
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
      window.clearTimeout(timeoutId)
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (
        previousActiveElementRef.current instanceof HTMLElement &&
        previousActiveElementRef.current.isConnected
      ) {
        previousActiveElementRef.current.focus()
      }
    }
  }, [closeOnEscape, initialFocusRef, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4 sm:p-6"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <section
        ref={dialogRef}
        aria-describedby={describedBy}
        aria-label={title ? undefined : ariaLabel}
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={`grid max-h-[calc(100dvh-2rem)] w-full max-w-lg gap-5 overflow-y-auto rounded-dialog border border-border-strong bg-surface-overlay p-5 text-text-primary shadow-overlay sm:max-h-[calc(100dvh-3rem)] sm:p-6 ${className}`}
        role="dialog"
        tabIndex={-1}
      >
        {title && (
          <h2 id={titleId} className="m-0 min-w-0 break-words text-xl font-semibold leading-tight">
            {title}
          </h2>
        )}
        {children}
      </section>
    </div>,
    document.body
  )
}
