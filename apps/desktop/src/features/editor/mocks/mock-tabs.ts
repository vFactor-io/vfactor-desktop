import type { Tab } from "@/features/chat/types"

export const initialTabs: Tab[] = [
  { id: "1", type: "chat", title: "Untitled" },
  { id: "2", type: "file", title: "eslint.config.js", filePath: "eslint.config.js" },
  { id: "3", type: "diff", title: "utils.ts", filePath: "utils.ts" },
]
