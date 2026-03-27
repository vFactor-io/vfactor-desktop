import { useState, useEffect, useCallback } from "react"
import { useProjectStore } from "@/features/workspace/store"
import { useChatStore } from "../store/chatStore"
import type { RuntimeModel } from "../types"

export function useModels() {
  const { selectedProjectId } = useProjectStore()
  const listModels = useChatStore((state) => state.listModels)
  const [models, setModels] = useState<RuntimeModel[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    if (!selectedProjectId) {
      setModels([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await listModels(selectedProjectId)
      setModels(response)
    } catch (err) {
      console.error("[useModels] Failed to fetch models:", err)
      setError(String(err))
      setModels([])
    } finally {
      setIsLoading(false)
    }
  }, [listModels, selectedProjectId])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return {
    models,
    isLoading,
    error,
    refetch: fetchModels,
  }
}
