export { LlmConfigError, LlmNetworkError, LlmResponseError } from "./errors.js";
export {
  getConfig,
  chatCompletion,
  transcribeAudio,
  type LlmConfig,
  type LlmMessage,
  type LlmContentPart,
  type LlmTool,
  type LlmToolCall,
  type LlmUsage,
  type LlmChoice,
  type LlmResponse,
  type ChatCompletionOptions,
  type TranscribeResult,
} from "./client.js";
