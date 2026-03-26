import * as vscode from "vscode";

export interface ChatStreamWriter {
  write(chunk: string): void;
  end(totalChars: number): void;
  error(error: unknown): void;
}

export class ChatOutputLogger {
  private outputChannel?: vscode.OutputChannel;

  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("Nimis Chat");
    }
    return this.outputChannel;
  }

  createStreamWriter(): ChatStreamWriter {
    const outputChannel = this.getOutputChannel();
    const streamTimestamp = new Date().toISOString();
    let wroteAnyChunk = false;

    outputChannel.appendLine(`[${streamTimestamp}] Chat stream start`);

    return {
      write(chunk: string) {
        if (!chunk) return;
        wroteAnyChunk = true;
        outputChannel.append(chunk);
      },
      end(totalChars: number) {
        if (wroteAnyChunk) {
          outputChannel.appendLine("");
        }
        outputChannel.appendLine(
          `[${streamTimestamp}] Chat stream end (${totalChars} chars)`
        );
      },
      error(error: unknown) {
        if (wroteAnyChunk) {
          outputChannel.appendLine("");
        }
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "unknown";
        outputChannel.appendLine(
          `[${streamTimestamp}] Chat stream error: ${message}`
        );
      },
    };
  }
}
