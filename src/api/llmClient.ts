export interface CompletionRequest {
  prompt: string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  maxTokens?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ILLMClient {
  complete(request: CompletionRequest): Promise<string>;
  streamComplete(
    request: CompletionRequest,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<void>;
  healthCheck(): Promise<boolean>;
  updateServerUrl(serverUrl: string): void;
}
