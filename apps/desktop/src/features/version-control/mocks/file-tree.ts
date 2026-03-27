import type { FileTreeItem } from "../types"

export const mockFileTreeData: Record<string, FileTreeItem> = {
  root: {
    name: "root",
    children: ["src", "package.json", "README.md"],
  },
  src: {
    name: "src",
    children: ["components", "hooks", "lib", "App.tsx", "main.tsx"],
  },
  components: {
    name: "components",
    children: ["layout", "ui", "chat"],
  },
  layout: {
    name: "layout",
    children: ["AppHeader.tsx", "AppLayout.tsx", "LeftSidebar.tsx", "RightSidebar.tsx"],
  },
  ui: {
    name: "ui",
    children: ["button.tsx", "dialog.tsx", "tree.tsx"],
  },
  chat: {
    name: "chat",
    children: ["ChatContainer.tsx", "ChatInput.tsx", "ChatMessages.tsx"],
  },
  hooks: {
    name: "hooks",
    children: ["useChat.ts"],
  },
  lib: {
    name: "lib",
    children: ["utils.ts", "mock-chat.ts"],
  },
  "AppHeader.tsx": { name: "AppHeader.tsx" },
  "AppLayout.tsx": { name: "AppLayout.tsx" },
  "LeftSidebar.tsx": { name: "LeftSidebar.tsx" },
  "RightSidebar.tsx": { name: "RightSidebar.tsx" },
  "button.tsx": { name: "button.tsx" },
  "dialog.tsx": { name: "dialog.tsx" },
  "tree.tsx": { name: "tree.tsx" },
  "ChatContainer.tsx": { name: "ChatContainer.tsx" },
  "ChatInput.tsx": { name: "ChatInput.tsx" },
  "ChatMessages.tsx": { name: "ChatMessages.tsx" },
  "useChat.ts": { name: "useChat.ts" },
  "utils.ts": { name: "utils.ts" },
  "mock-chat.ts": { name: "mock-chat.ts" },
  "App.tsx": { name: "App.tsx" },
  "main.tsx": { name: "main.tsx" },
  "package.json": { name: "package.json" },
  "README.md": { name: "README.md" },
}
