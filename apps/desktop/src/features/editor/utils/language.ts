const extensionToLanguage: Record<string, string> = {
  // JavaScript/TypeScript
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",

  // Data formats
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  toml: "toml",

  // Config files
  md: "markdown",
  mdx: "markdown",

  // Backend
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",

  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",

  // Other
  sql: "sql",
  graphql: "graphql",
  dockerfile: "dockerfile",
}

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return extensionToLanguage[ext] ?? "plaintext"
}
