import { useEffect, useState } from "react"
import {
  durationStorageKey,
  focusStorageKey,
  newFocusBlock,
  newFocusBreak,
  readFocusDuration,
  readFocusSession,
  resolveFocusTime,
  type FocusDuration,
  type FocusSession,
} from "../focusSession"

// A página é remontada por userId: nenhum estado em memória atravessa contas.
export function useFocusSession(userId: number | string) {
  const [session, setSession] = useState<FocusSession | null>(() => {
    try {
      return readFocusSession(window.localStorage, userId)
    } catch {
      return null
    }
  })
  const [duration, setDuration] = useState(() => {
    try {
      return readFocusDuration(window.localStorage, userId)
    } catch {
      return 45
    }
  })
  const [now, setNow] = useState(Date.now)
  const [storageUnavailable, setStorageUnavailable] = useState(false)

  function save(next: FocusSession | null) {
    setSession(next)
    try {
      if (next) window.localStorage.setItem(focusStorageKey(userId), JSON.stringify(next))
      else window.localStorage.removeItem(focusStorageKey(userId))
    } catch {
      setStorageUnavailable(true)
    }
  }

  useEffect(() => {
    function updateClock() {
      setNow(Date.now())
    }
    const interval = window.setInterval(updateClock, 15000)
    window.addEventListener("focus", updateClock)
    document.addEventListener("visibilitychange", updateClock)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", updateClock)
      document.removeEventListener("visibilitychange", updateClock)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const next = resolveFocusTime(session, now)
    if (next !== session) {
      setSession(next)
      try {
        window.localStorage.setItem(focusStorageKey(userId), JSON.stringify(next))
      } catch {
        setStorageUnavailable(true)
      }
    }
  }, [now, session, userId])

  function chooseDuration(next: FocusDuration) {
    setDuration(next)
    try {
      window.localStorage.setItem(durationStorageKey(userId), String(next))
    } catch {
      setStorageUnavailable(true)
    }
  }

  function start(
    activity: Pick<FocusSession, "activityText" | "taskId" | "taskTitle">,
    minutes = duration
  ) {
    chooseDuration(minutes)
    const timestamp = Date.now()
    setNow(timestamp)
    save(newFocusBlock(activity, minutes, timestamp))
  }

  return {
    session: session ? resolveFocusTime(session, now) : null,
    duration,
    now,
    storageUnavailable,
    chooseDuration,
    start,
    finish: () => save({ ...session, phase: "ended", endedManually: true }),
    startBreak: () => {
      setNow(Date.now())
      save(newFocusBreak(session))
    },
    finishBreak: () => save({ ...session, phase: "break-ended" }),
    clear: () => save(null),
  }
}
