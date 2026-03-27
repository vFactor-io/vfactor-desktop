import type { UIMessage } from "ai";

const MOCK_RESPONSES: Record<string, string> = {
  hello: "Hello! How can I assist you today?",
  hi: "Hi there! What can I help you with?",
  help: "I'm here to help! This is a development mock - real AI features coming soon.",
  default:
    "I'm a mock AI assistant running locally. This interface is for UI development - real AI integration will be added later. Try saying 'hello' or 'help'!",
};

function getResponse(input: string): string {
  const lower = input.toLowerCase().trim();
  for (const [key, value] of Object.entries(MOCK_RESPONSES)) {
    if (key !== "default" && lower.includes(key)) {
      return value;
    }
  }
  return MOCK_RESPONSES.default;
}

function getMessageText(message: UIMessage): string {
  for (const part of message.parts) {
    if (part.type === "text") {
      return part.text;
    }
  }
  return "";
}

export async function* streamMockResponse(
  messages: UIMessage[]
): AsyncGenerator<string> {
  const lastMessage = messages[messages.length - 1];
  const userInput = lastMessage ? getMessageText(lastMessage) : "";

  const response = getResponse(userInput);
  const words = response.split(" ");

  for (const word of words) {
    await new Promise((resolve) =>
      setTimeout(resolve, 30 + Math.random() * 70)
    );
    yield word + " ";
  }
}
