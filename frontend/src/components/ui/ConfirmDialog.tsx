import React from "react"

import Button from "./Button"
import Dialog from "./Dialog"

export default function ConfirmDialog({
  cancelLabel = "Cancelar",
  confirmLabel,
  message,
  error = "",
  loading = false,
  onCancel,
  onConfirm,
  title,
  variant = "danger",
}) {
  return (
    <Dialog closeOnBackdrop={false} onClose={onCancel} title={title}>
      <p className="m-0 min-w-0 break-words text-sm leading-6 text-text-secondary">{message}</p>
      {error && (
        <p role="alert" className="m-0 min-w-0 break-words text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button disabled={loading} variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          loading={loading}
          variant={variant === "danger" ? "danger" : "primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
