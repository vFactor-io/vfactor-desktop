/**
 * Nucleus Desktop - OpenCode CLI
 *
 * Usage:
 *   bun run cli "your prompt"
 */

import {
  createOpencode,
  type EventMessagePartUpdated,
  type EventMessageUpdated,
  type GlobalEvent,
  type TextPart,
  type ToolPart,
  type ToolState,
} from "@opencode-ai/sdk"

const HELP_FLAGS = new Set(["--help", "-h"])
const NO_STREAM_FLAG = "--no-stream"
const RAW_ONLY_FLAG = "--raw-only"
const JSON_ONLY_FLAG = "--json-only"
const STREAM_TOOLS_FLAG = "--stream-tools"
const DEBUG_SUBAGENT_FLAG = "--debug-subagent"
const KNOWN_FLAGS = new Set([
  ...HELP_FLAGS,
  NO_STREAM_FLAG,
  RAW_ONLY_FLAG,
  JSON_ONLY_FLAG,
  STREAM_TOOLS_FLAG,
  DEBUG_SUBAGENT_FLAG,
])

function printUsage(): void {
  console.log(
    "Usage: bun run cli \"your prompt\" [--no-stream] [--raw-only] [--json-only] [--stream-tools] [--debug-subagent]"
  )
}

function extractTextFromParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) {
    return null
  }

  const textParts = parts
    .filter((part): part is { type: string; text?: string } =>
      Boolean(part && typeof part === "object" && "type" in part)
    )
    .map((part) => (part.type === "text" ? part.text : null))
    .filter((text): text is string => typeof text === "string")

  return textParts.length ? textParts.join("\n") : null
}

function extractTextFromResponse(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null
  }

  if ("parts" in response) {
    const text = extractTextFromParts((response as { parts?: unknown }).parts)
    if (text) {
      return text
    }
  }

  if ("message" in response) {
    const message = (response as { message?: unknown }).message
    if (message && typeof message === "object" && "content" in message) {
      const text = extractTextFromParts((message as { content?: unknown }).content)
      if (text) {
        return text
      }
    }
  }

  if ("content" in response) {
    const text = extractTextFromParts((response as { content?: unknown }).content)
    if (text) {
      return text
    }
  }

  return null
}

function formatToolState(state: ToolState, toolName: string): string {
  if (state.status === "pending") {
    return `[Tool ${toolName}] pending`
  }

  if (state.status === "running") {
    return `[Tool ${toolName}] running${state.title ? `: ${state.title}` : ""}`
  }

  if (state.status === "error") {
    return `[Tool ${toolName}] error: ${state.error}`
  }

  return `[Tool ${toolName}] completed${state.title ? `: ${state.title}` : ""}`
}

type StreamResult = {
  streamedText: boolean
  streamedTools: boolean
  childSessionIds: Set<string>
}

// Subtask part type (not exported from SDK, define locally)
interface SubtaskPart {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
}

async function streamAssistantParts(
  stream: AsyncIterable<GlobalEvent>,
  sessionID: string,
  streamTools: boolean,
  debugSubagent: boolean = false
): Promise<StreamResult> {
  const seenParts = new Set<string>()
  const toolStates = new Map<string, string>()
  const childSessionIds = new Set<string>()
  const seenSubtasks = new Set<string>()
  let streamedText = false
  let streamedTools = false
  let assistantMessageID: string | null = null

  for await (const event of stream) {
    if (!event || typeof event !== "object" || !("payload" in event)) {
      continue
    }

    const payload = (event as GlobalEvent).payload

    if (!payload || typeof payload !== "object") {
      continue
    }

    // Debug: log all events when debugging subagents
    if (debugSubagent) {
      console.log(`\n[DEBUG EVENT] type=${payload.type}`)
      if (payload.type === "message.part.updated") {
        const { part } = (payload as EventMessagePartUpdated).properties
        console.log(`  part.type=${part.type}, part.sessionID=${part.sessionID}`)
        if (part.type === "subtask") {
          console.log(`  SUBTASK FOUND:`, JSON.stringify(part, null, 2))
        }
      }
      if (payload.type === "session.created") {
        console.log(`  SESSION CREATED:`, JSON.stringify(payload, null, 2))
      }
    }

    if (payload.type === "message.updated") {
      const { info } = (payload as EventMessageUpdated).properties

      if (debugSubagent) {
        console.log(`  message role=${info.role}, sessionID=${info.sessionID}, parentSession=${sessionID}`)
      }

      if (info.sessionID === sessionID && info.role === "assistant") {
        assistantMessageID = info.id
      }

      continue
    }

    if (payload.type !== "message.part.updated") {
      continue
    }

    const { part, delta } = (payload as EventMessagePartUpdated).properties

    // Track subtask parts (these indicate subagent invocations)
    if (part.type === "subtask" && !seenSubtasks.has(part.id)) {
      seenSubtasks.add(part.id)
      const subtask = part as unknown as SubtaskPart
      console.log(`\n[SUBTASK] agent=${subtask.agent}, description="${subtask.description}"`)
      console.log(`  prompt: ${subtask.prompt.slice(0, 100)}...`)
      console.log(`  partSessionID: ${subtask.sessionID}`)
      // The subtask's sessionID might be the child session - track it
      if (subtask.sessionID !== sessionID) {
        childSessionIds.add(subtask.sessionID)
        console.log(`  -> Detected child session: ${subtask.sessionID}`)
      }
    }

    // Also track events from child sessions
    if (childSessionIds.has(part.sessionID) && debugSubagent) {
      console.log(`\n[CHILD SESSION ${part.sessionID}] part.type=${part.type}`)
      if (part.type === "tool") {
        const toolPart = part as ToolPart
        console.log(`  tool=${toolPart.tool}, status=${toolPart.state.status}`)
      }
    }

    // Skip parts not from our main session (unless debugging)
    if (part.sessionID !== sessionID) {
      continue
    }

    if (!assistantMessageID) {
      continue
    }

    if (part.messageID !== assistantMessageID) {
      continue
    }

    if (part.type === "text") {
      const textPart = part as TextPart

      if (!streamedText) {
        console.log("\nAssistant Response (streaming):\n")
        streamedText = true
      }

      if (typeof delta === "string") {
        process.stdout.write(delta)
      } else if (!seenParts.has(textPart.id)) {
        process.stdout.write(textPart.text)
      }

      seenParts.add(textPart.id)
      continue
    }

    if (part.type === "tool" && streamTools) {
      const toolPart = part as ToolPart
      const toolState = toolPart.state
      const lastState = toolStates.get(toolPart.callID)

      if (!lastState || lastState !== toolState.status) {
        if (!streamedTools) {
          console.log("\n\nTool Activity:\n")
          streamedTools = true
        }

        console.log(formatToolState(toolState, toolPart.tool))

        if (toolState.status === "completed" && toolState.output) {
          console.log(toolState.output)
        }

        toolStates.set(toolPart.callID, toolState.status)
      }
    }
  }

  return { streamedText, streamedTools, childSessionIds }
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const helpRequested = args.some((arg) => HELP_FLAGS.has(arg))
  const jsonOnly = args.includes(JSON_ONLY_FLAG)
  const rawOnly = jsonOnly || args.includes(RAW_ONLY_FLAG)
  const streamEnabled = !rawOnly && !args.includes(NO_STREAM_FLAG)
  const streamTools = streamEnabled && args.includes(STREAM_TOOLS_FLAG)
  const debugSubagent = args.includes(DEBUG_SUBAGENT_FLAG)
  const promptArgs = args.filter((arg) => !KNOWN_FLAGS.has(arg))

  if (!promptArgs.length || helpRequested) {
    printUsage()
    process.exit(promptArgs.length ? 0 : 1)
  }

  const prompt = promptArgs.join(" ")
  const opencode = await createOpencode()

  try {
    const sessionResponse = await opencode.client.session.create({
      body: { title: prompt.slice(0, 60) },
    })

    const session = sessionResponse.data

    if (!session?.id) {
      throw new Error("Failed to create session")
    }

    if (debugSubagent) {
      console.log(`[DEBUG] Parent session ID: ${session.id}`)
    }

    const streamController = new AbortController()
    const streamTask = streamEnabled
      ? opencode.client.global
          .event({ signal: streamController.signal })
          .then((result) => streamAssistantParts(result.stream, session.id, streamTools, debugSubagent))
      : Promise.resolve({ streamedText: false, streamedTools: false, childSessionIds: new Set<string>() })

    const result = await opencode.client.session.prompt({
      path: { id: session.id },
      body: { parts: [{ type: "text", text: prompt }] },
    })

    streamController.abort()
    const { streamedText, childSessionIds } = await streamTask.catch(() => ({
      streamedText: false,
      streamedTools: false,
      childSessionIds: new Set<string>(),
    }))

    if (jsonOnly) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }

    if (streamEnabled && streamedText) {
      console.log("\n")
    }

    console.log(`Session ID: ${session.id}`)

    // Debug: fetch and display child sessions
    if (debugSubagent) {
      console.log("\n[DEBUG] Fetching child sessions via API...")
      try {
        const childrenResponse = await opencode.client.session.children({
          path: { id: session.id },
        })
        const children = childrenResponse.data
        if (children && Array.isArray(children) && children.length > 0) {
          console.log(`[DEBUG] Found ${children.length} child session(s):`)
          for (const child of children) {
            console.log(`\n  Child Session: ${child.id}`)
            console.log(`    title: ${child.title}`)
            console.log(`    directory: ${child.directory}`)
            
            // Fetch messages from child session
            const messagesResponse = await opencode.client.session.messages({
              path: { id: child.id },
            })
            const messages = messagesResponse.data
            if (messages && Array.isArray(messages)) {
              console.log(`    messages: ${messages.length}`)
              for (const msg of messages) {
                const msgInfo = msg.info || msg
                console.log(`\n    [Message ${msgInfo.id}] role=${msgInfo.role}`)
                const parts = msg.parts || []
                console.log(`      parts: ${parts.length}`)
                for (const p of parts) {
                  if (p.type === "tool") {
                    const toolPart = p as ToolPart
                    const toolState = toolPart.state as ToolState & { title?: string }
                    console.log(`        [tool] ${toolPart.tool} - ${toolState?.status} - ${toolState?.title || ""}`)
                  } else if (p.type === "text") {
                    const textPart = p as TextPart
                    console.log(`        [text] ${textPart.text?.slice(0, 80)}...`)
                  } else {
                    console.log(`        [${p.type}]`)
                  }
                }
              }
            }
          }
        } else {
          console.log("[DEBUG] No child sessions found via API")
        }
      } catch (err) {
        console.log("[DEBUG] Error fetching child sessions:", err)
      }
      
      // Also check what we detected from events
      if (childSessionIds.size > 0) {
        console.log(`\n[DEBUG] Child sessions detected from events: ${Array.from(childSessionIds).join(", ")}`)
      }
    }

    if (!rawOnly && (!streamEnabled || !streamedText)) {
      const text = extractTextFromResponse(result.data)

      if (text) {
        console.log("\nAssistant Response:\n")
        console.log(text)
      }
    }

    // Check for subtask parts in the response
    if (debugSubagent && result.data) {
      const data = result.data as { parts?: unknown[] }
      if (data.parts && Array.isArray(data.parts)) {
        const subtaskParts = data.parts.filter((p: unknown) => 
          p && typeof p === "object" && (p as { type?: string }).type === "subtask"
        )
        if (subtaskParts.length > 0) {
          console.log(`\n[DEBUG] Found ${subtaskParts.length} subtask part(s) in response:`)
          console.log(JSON.stringify(subtaskParts, null, 2))
        }
      }
    }

    console.log("\nRaw Response:\n")
    console.log(JSON.stringify(result.data, null, 2))
  } finally {
    opencode.server.close()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
