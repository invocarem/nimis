import axios, { AxiosInstance } from "axios";
import { CompletionRequest, ILLMClient } from "./llmClient";

export class VLLMClient implements ILLMClient {
  private client: AxiosInstance;
  private serverUrl: string;
  private model: string;

  constructor(serverUrl: string, model: string) {
    this.serverUrl = serverUrl;
    this.model = model;
    this.client = axios.create({
      baseURL: serverUrl,
      timeout: 300000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async complete(request: CompletionRequest): Promise<string> {
    try {
      const response = await this.client.post("/v1/completions", {
        model: this.model,
        prompt: request.prompt,
        temperature: request.temperature ?? 0.7,
        top_p: request.top_p ?? 0.9,
        max_tokens: request.maxTokens ?? 2048,
        stop: request.stop ?? [],
        stream: false,
      });

      return response.data.choices?.[0]?.text || "";
    } catch (error: any) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          `Cannot connect to vLLM server at ${this.serverUrl}. Make sure the server is running.`
        );
      }
      throw new Error(`VLLMClient error: ${error.message}`);
    }
  }

  async streamComplete(
    request: CompletionRequest,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await this.client.post(
        "/v1/completions",
        {
          model: this.model,
          prompt: request.prompt,
          temperature: request.temperature ?? 0.7,
          top_p: request.top_p ?? 0.9,
          max_tokens: request.maxTokens ?? 2048,
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

        if (abortSignal) {
          abortSignal.addEventListener("abort", () => {
            isAborted = true;
            if (response.data && typeof response.data.destroy === "function") {
              response.data.destroy();
            }
            resolve();
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
            const trimmed = line.trim();
            if (trimmed === "data: [DONE]") {
              resolve();
              return;
            }
            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const text = data.choices?.[0]?.text;
                if (text) {
                  onChunk(text);
                }
                if (data.choices?.[0]?.finish_reason) {
                  resolve();
                }
              } catch (e) {
                console.error(
                  `[STREAM] Failed to parse vLLM streaming data:`,
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
          if (!isAborted && !abortSignal?.aborted) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch (error: any) {
      if (
        error.name === "CanceledError" ||
        error.name === "AbortError" ||
        abortSignal?.aborted
      ) {
        return;
      }
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          `Cannot connect to vLLM server at ${this.serverUrl}. Make sure the server is running.`
        );
      }
      throw new Error(`VLLMClient stream error: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get("/health", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

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
