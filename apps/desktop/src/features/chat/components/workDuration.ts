import { useEffect, useRef, useState } from "react"

export function formatElapsedDuration(durationMs: number): string {
  const safeDurationMs = Math.max(0, durationMs)
  const hours = Math.floor(safeDurationMs / 3_600_000)
  const minutes = Math.floor((safeDurationMs % 3_600_000) / 60_000)
  const seconds = (safeDurationMs % 60_000) / 1000
  const secondsWithTenths = `${seconds.toFixed(1)}s`

  if (hours > 0) {
    return `${hours}h, ${minutes}m, ${secondsWithTenths}`
  }

  if (minutes > 0) {
    return `${minutes}m, ${secondsWithTenths}`
  }

  return secondsWithTenths
}

export function useElapsedDuration(
  startTime: number | null | undefined,
  isActive: boolean,
  endTime?: number
): string | null {
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isActive || startTime == null) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = setInterval(() => {
      setCurrentTime(Date.now())
    }, 50)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isActive, startTime])

  if (startTime == null) {
    return null
  }

  const effectiveEndTime = isActive ? currentTime : (endTime ?? currentTime)
  return formatElapsedDuration(effectiveEndTime - startTime)
}
