/**
 * Chat feature types.
 * These types are owned by the app so multiple agent harnesses can map into one UI.
 */

export type ChatStatus = "idle" | "streaming" | "error";

export type TabType = "chat" | "file" | "diff";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  filePath?: string;
  previousFilePath?: string | null;
}

export type HarnessId = "codex" | "claude-code";

export interface HarnessCapabilities {
  supportsCommands: boolean;
  supportsAgentMentions: boolean;
  supportsFileSearch: boolean;
  supportsSubagents: boolean;
  supportsArchive: boolean;
  supportsDelete: boolean;
}

export interface HarnessDefinition {
  id: HarnessId;
  label: string;
  description: string;
  adapterStatus: "planned" | "experimental" | "ready";
  capabilities: HarnessCapabilities;
}

export interface RuntimeSession {
  id: string;
  remoteId?: string;
  harnessId: HarnessId;
  title?: string;
  projectPath?: string;
  parentSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  createdAt: number;
  turnId?: string;
  finishReason?: "end_turn" | "stop" | "error";
  itemType?:
    | "userMessage"
    | "agentMessage"
    | "reasoning"
    | "plan"
    | "commandExecution"
    | "fileChange"
    | "mcpToolCall"
    | "dynamicToolCall"
    | "collabAgentToolCall"
    | "webSearch"
    | "imageGeneration"
    | "imageView"
    | "enteredReviewMode"
    | "exitedReviewMode"
    | "contextCompaction"
    | "approval";
  phase?: string | null;
}

export interface RuntimeTextPart {
  id: string;
  type: "text";
  text: string;
}

export type ToolExecutionStatus = "pending" | "running" | "completed" | "error";

export interface RuntimeToolState {
  status: ToolExecutionStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: unknown;
  title?: string;
  subtitle?: string;
}

export interface RuntimeToolPart {
  id: string;
  type: "tool";
  messageId: string;
  sessionId: string;
  tool: string;
  state: RuntimeToolState;
}

export type RuntimeMessagePart = RuntimeTextPart | RuntimeToolPart;

export interface MessageWithParts {
  info: RuntimeMessage;
  parts: RuntimeMessagePart[];
}

export interface ChildSessionState {
  session: RuntimeSession;
  toolParts: RuntimeToolPart[];
  isActive: boolean;
}

export interface RuntimeAgent {
  name: string;
  description: string;
  mode: "primary" | "subagent" | "all";
  builtIn: boolean;
}

export interface RuntimeCommand {
  name: string;
  description: string;
  kind: "builtin" | "custom";
  agent?: string;
  model?: string;
}

export interface RuntimeFileSearchResult {
  path: string;
  type: "file" | "directory";
}

export type RuntimeReasoningEffort = string;

export interface RuntimeModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: RuntimeReasoningEffort | null;
  supportedReasoningEfforts?: RuntimeReasoningEffort[];
}

export interface RuntimePromptOption {
  id: string;
  label: string;
  description?: string;
}

export interface RuntimePromptQuestion {
  id: string;
  label: string;
  description?: string;
  kind: "single_select" | "multi_select" | "text";
  options?: RuntimePromptOption[];
  allowOther?: boolean;
  isSecret?: boolean;
  required?: boolean;
}

export interface RuntimePromptBase {
  id: string;
  title: string;
  body?: string;
}

export interface RuntimeQuestionPrompt extends RuntimePromptBase {
  kind: "question";
  questions: RuntimePromptQuestion[];
}

export interface RuntimeApprovalFileChange {
  path: string;
  type: "add" | "update" | "delete" | "change";
  content?: string;
  diff?: string;
}

export interface RuntimeApprovalRequest {
  kind: "fileChange" | "commandExecution";
  callId: string;
  turnId: string;
  conversationId: string;
  requestId?: string | number;
  itemId?: string;
  changes?: RuntimeApprovalFileChange[];
  command?: string;
  commandSegments?: string[];
  cwd?: string;
  reason?: string;
  grantRoot?: string;
  commandActions?: unknown[];
}

export interface RuntimeApprovalPrompt extends RuntimePromptBase {
  kind: "approval";
  approval: RuntimeApprovalRequest;
}

export type RuntimePrompt = RuntimeQuestionPrompt | RuntimeApprovalPrompt;
export type RuntimeApprovalDisplayState = "pending" | "approved" | "denied";

export interface RuntimeQuestionPromptResponse {
  kind: "question";
  promptId: string;
  answers: Record<string, string | string[]>;
  customAnswers: Record<string, string>;
  text: string;
}

export interface RuntimeApprovalPromptResponse {
  kind: "approval";
  promptId: string;
  decision: "approve" | "deny";
  text: string;
}

export type RuntimePromptResponse =
  | RuntimeQuestionPromptResponse
  | RuntimeApprovalPromptResponse;

export interface RuntimePromptState {
  prompt: RuntimePrompt;
  status: "active" | "dismissed" | "answered";
  createdAt: number;
  response?: RuntimePromptResponse;
  updatedAt?: number;
}

export type CollaborationModeKind = "default" | "plan";

export interface HarnessTurnInput {
  session: RuntimeSession;
  projectPath?: string;
  text: string;
  agent?: string;
  collaborationMode?: CollaborationModeKind;
  model?: string;
  reasoningEffort?: RuntimeReasoningEffort | null;
  onUpdate?: (result: HarnessTurnResult) => void;
}

export interface HarnessCommandInput {
  session: RuntimeSession;
  projectPath?: string;
  command: string;
  args?: string;
}

export interface HarnessPromptInput {
  session: RuntimeSession;
  projectPath?: string;
  prompt: RuntimePrompt;
  response: RuntimePromptResponse;
}

export interface HarnessTurnResult {
  messages?: MessageWithParts[];
  childSessions?: ChildSessionState[];
  prompt?: RuntimePrompt | null;
}

export interface HarnessAdapter {
  definition: HarnessDefinition;
  initialize: () => Promise<void>;
  createSession: (projectPath: string) => Promise<RuntimeSession>;
  listAgents: () => Promise<RuntimeAgent[]>;
  listCommands: () => Promise<RuntimeCommand[]>;
  listModels: () => Promise<RuntimeModel[]>;
  searchFiles: (query: string, directory?: string) => Promise<RuntimeFileSearchResult[]>;
  sendMessage: (input: HarnessTurnInput) => Promise<HarnessTurnResult>;
  answerPrompt: (input: HarnessPromptInput) => Promise<HarnessTurnResult>;
  executeCommand: (input: HarnessCommandInput) => Promise<HarnessTurnResult>;
  abortSession: (session: RuntimeSession) => Promise<void>;
}

/** Content block in a message */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** A timestamped content block */
export interface TimestampedContent {
  content: ContentBlock;
  createdAt: number;
}

/** Tool call status */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/** Tool kind for categorization */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "diff"
  | "unknown";

/** Tool call content items */
export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string; newText?: string }
  | { type: "terminal"; terminalId: string };

/** Tool call state */
export interface ToolCallState {
  id: string;
  name: string;
  title: string;
  kind?: ToolKind;
  status: ToolCallStatus;
  content: ToolCallContent[];
  createdAt: number;
}

/** Message in a conversation */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: TimestampedContent[];
  toolCalls: ToolCallState[];
  stopReason?: string;
  createdAt: number;
}

/** Permission option */
export interface PermissionOption {
  id: string;
  label: string;
  description?: string;
}

/** Pending permission request */
export interface PendingPermission {
  requestId: string | number;
  toolCallId: string;
  toolName: string;
  message: string;
  options: PermissionOption[];
  createdAt: number;
}

/** Resolved permission */
export interface ResolvedPermission {
  requestId: string | number;
  toolCallId: string;
  selectedOptionId: string;
  selectedOptionLabel: string;
  createdAt: number;
  resolvedAt: number;
}
