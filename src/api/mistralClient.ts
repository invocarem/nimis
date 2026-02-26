import axios, { AxiosInstance } from "axios";
import { CompletionRequest, ILLMClient } from "./llmClient";

const MISTRAL_BASE_URL = "https://api.mistral.ai";

export class MistralClient implements ILLMClient {
  private client: AxiosInstance;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = axios.create({
      baseURL: MISTRAL_BASE_URL,
      timeout: 300000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  async complete(request: CompletionRequest): Promise<string> {
    try {
      const response = await this.client.post("/v1/chat/completions", {
        model: this.model,
        messages: [{ role: "user", content: request.prompt }],
        temperature: request.temperature ?? 0.7,
        top_p: request.top_p ?? 0.9,
        max_tokens: request.maxTokens ?? 2048,
        stop: request.stop ?? [],
        stream: false,
      });

      return response.data.choices?.[0]?.message?.content || "";
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error(
          "Mistral API authentication failed. Check your API key in nimis.apiKey."
        );
      }
      throw new Error(`MistralClient error: ${error.message}`);
    }
  }

  async streamComplete(
    request: CompletionRequest,
    onChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    try {
      const response = await this.client.post(
        "/v1/chat/completions",
        {
          model: this.model,
          messages: [{ role: "user", content: request.prompt }],
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
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  onChunk(content);
                }
                if (data.choices?.[0]?.finish_reason) {
                  resolve();
                }
              } catch (e) {
                console.error(
                  `[STREAM] Failed to parse Mistral streaming data:`,
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
      if (error.response?.status === 401) {
        throw new Error(
          "Mistral API authentication failed. Check your API key in nimis.apiKey."
        );
      }
      throw new Error(`MistralClient stream error: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get("/v1/models", { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  updateServerUrl(_serverUrl: string) {
    // No-op: Mistral uses a fixed API endpoint.
  }
}
