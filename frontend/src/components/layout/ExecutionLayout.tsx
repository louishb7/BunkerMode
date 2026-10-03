import React, { useState } from "react"

import { ArrowLeft } from "lucide-react"
import Brand from "../ui/Brand"
import OutboxNotice from "../system/OutboxNotice"
import Button from "../ui/Button"

export default function ExecutionLayout({ children, onReturnToTasks }) {
  const [returnLoading, setReturnLoading] = useState(false)

  async function handleReturn() {
    setReturnLoading(true)
    await onReturnToTasks()
    setReturnLoading(false)
  }

  return (
    <div className="min-h-dvh bg-canvas text-text-primary">
      <header className="border-b border-border bg-peripheral">
        <div className="mx-auto flex min-h-15 w-full max-w-[760px] items-center justify-between gap-4 px-4 sm:px-6">
          <Brand compact />
          <div className="flex items-center gap-2">
            <OutboxNotice />
            <Button loading={returnLoading} size="small" variant="ghost" onClick={handleReturn}>
              <ArrowLeft size={16} aria-hidden="true" />
              Voltar às tarefas
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 py-7 sm:px-6 sm:py-10">{children}</main>
    </div>
  )
}
