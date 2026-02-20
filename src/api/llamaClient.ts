import axios, { AxiosInstance } from "axios";

export interface LlamaCompletionRequest {
  prompt: string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  n_predict?: number;
  stop?: string[];
  stream?: boolean;
}

export interface LlamaCompletionResponse {
  content: string;
  stop: boolean;
  tokens_predicted?: number;
  tokens_evaluated?: number;
}

export class LlamaClient {
  private client: AxiosInstance;
  private serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.client = axios.create({
      baseURL: serverUrl,
      timeout: 300000, // 5 minutes timeout
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Send a completion request to llama.cpp server
   */
  async complete(request: LlamaCompletionRequest): Promise<string> {
    try {
      const response = await this.client.post("/completion", {
        prompt: request.prompt,
        temperature: request.temperature ?? 0.7,
        top_k: request.top_k ?? 40,
        top_p: request.top_p ?? 0.9,
        n_predict: request.n_predict ?? 2048,
        stop: request.stop ?? [],
        stream: false,
      });

      return response.data.content || "";
    } catch (error: any) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          `Cannot connect to llama.cpp server at ${this.serverUrl}. Make sure the server is running.`
        );
      }
      throw new Error(`LlamaClient error: ${error.message}`);
    }
  }

  /**
   * Stream completion from llama.cpp server
   * @param request The completion request
   * @param onChunk Callback for each chunk of text
   * @param abortSignal Optional AbortSignal to cancel the stream
   */
  async streamComplete(
    request: LlamaCompletionRequest,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await this.client.post(
        "/completion",
        {
          prompt: request.prompt,
          temperature: request.temperature ?? 0.7,
          top_k: request.top_k ?? 40,
          top_p: request.top_p ?? 0.9,
          n_predict: request.n_predict ?? 2048,
          stop: request.stop ?? [],
          stream: true,
        },
        {
          responseType: "stream",
          signal: abortSignal,
        }
      );

      return new Promise((resolve, reject) => {
        let buffer = "";
        let isAborted = false;

        // Handle abort signal
        if (abortSignal) {
          abortSignal.addEventListener("abort", () => {
            isAborted = true;
            // Destroy the stream
            if (response.data && typeof response.data.destroy === "function") {
              response.data.destroy();
            }
            resolve(); // Resolve instead of reject to handle cancellation gracefully
          });
        }

        response.data.on("data", (chunk: Buffer) => {
          if (isAborted) {
            return;
          }
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (isAborted) {
              return;
            }
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  //console.log(`[STREAM] Received chunk: "${data.content}"`);
                  onChunk(data.content);
                }
                if (data.stop) {
                  //console.log(`[STREAM] Stream completed`);
                  resolve();
                }
              } catch (e) {
                console.error(
                  `[STREAM] Failed to parse streaming data:`,
                  line,
                  e
                );
              }
            }
          }
        });

        response.data.on("end", () => {
          if (!isAborted) {
            resolve();
          }
        });

        response.data.on("error", (error: Error) => {
          // Don't reject if aborted
          if (!isAborted && !abortSignal?.aborted) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch (error: any) {
      // Handle abort errors gracefully
      if (
        error.name === "CanceledError" ||
        error.name === "AbortError" ||
        abortSignal?.aborted
      ) {
        return; // Cancellation is not an error
      }
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          `Cannot connect to llama.cpp server at ${this.serverUrl}. Make sure the server is running.`
        );
      }
      throw new Error(`LlamaClient stream error: ${error.message}`);
    }
  }

  /**
   * Check if the server is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get("/health", { timeout: 5000 }); // 5 second timeout for health check
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update the server URL
   */
  updateServerUrl(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.client = axios.create({
      baseURL: serverUrl,
      timeout: 240000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
