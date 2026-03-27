import { useState, useCallback } from "react"
import { useProjectStore } from "@/features/workspace/store"
import { useChatStore } from "../store/chatStore"

export interface FileSearchResult {
  path: string
  type: "file" | "directory"
}

export function useFileSearch() {
  const { selectedProjectId } = useProjectStore()
  const searchFiles = useChatStore((state) => state.searchFiles)
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (query: string, directory?: string) => {
      if (!selectedProjectId || !query.trim()) {
        setResults([])
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await searchFiles(selectedProjectId, query.trim(), directory)

        const normalized: FileSearchResult[] = response.map((result) => ({
          path: result.path,
          type: result.type,
        }))

        setResults(normalized)
      } catch (err) {
        console.error("[useFileSearch] Failed to search files:", err)
        setError(String(err))
        setResults([])
      } finally {
        setIsLoading(false)
      }
    },
    [searchFiles, selectedProjectId]
  )

  const clear = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  return {
    results,
    isLoading,
    error,
    search,
    clear,
  }
}
