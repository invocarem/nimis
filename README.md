
# Nimis

An AI editor for VS Code that solves engineering problems through Vim. The AI thinks and operates in Vim — reading, navigating, and editing files with the same commands you would use, while you stay in the conversation.

## How It Works

You describe a problem in the chat sidebar. The AI reads your code with `:e`, navigates with motions and ranges, edits with `:s`, `dd`, `o`, `:g`, and writes with `:w` — all inside a live Vim buffer you can watch in real time. Tool calls loop automatically until the task is done.

```
You:   "Add error handling to the fetchUser function in src/api/users.ts"

Nimis: :e src/api/users.ts          ← opens the file
       /fetchUser                    ← finds the function
       :.,+10s/return fetch/return fetch(...).catch(handleError)/
       :w                            ← saves the file
```

## Features

- **Vim-native AI editing** — the LLM uses real Vim commands (`:e`, `:s`, `:g`, `dd`, `yy`, `p`, marks, registers, ranges) to operate on your files
- **Live Vim buffer** — toggle a Vim display in the sidebar showing buffer contents, cursor, mode, and status bar as the AI works
- **Agentic tool loop** — the AI plans, executes tools, reads results, and iterates until the task is complete
- **Multiple LLM backends** — llama.cpp (local), vLLM (local/remote), Mistral AI (cloud)
- **Native file tools** — `read_file`, `create_file`, `edit_file`, `list_files`, `find_files`, `grep_files`, `exec_terminal` when Vim isn't the right fit
- **MCP integration** — connect external Model Context Protocol servers for distributed tooling
- **Rule system** — define custom rules (Markdown/YAML/JSON) to guide LLM behavior, enforce standards, or automate workflows
- **State tracking** — conversation state, tool calls, and working files persist across sessions in `.nimis/state.json`
- **Streaming responses** — real-time token streaming with stop, continue, and decline controls
- **Rich markdown** — AI responses render with headers, code blocks, syntax highlighting, copy/insert buttons, and collapsible thinking blocks
- **Theme-aware UI** — adapts to VS Code light, dark, and high-contrast themes

## Vim Commands Supported

The Vim subsystem is not a gimmick — it's a full implementation that the AI uses as its primary editing interface.

### Ex Commands

| Command | Description |
|---------|-------------|
| `:e <file>` | Open file into buffer |
| `:w` / `:wq` / `:q` / `:q!` | Write, quit, force quit |
| `:[range]s/pat/repl/[flags]` | Substitute with regex, alternate delimiters |
| `:[range]d [reg]` | Delete lines (optionally into register) |
| `:[range]y [reg]` | Yank lines (optionally into register) |
| `:p` / `:P` | Put from register |
| `:g/pat/cmd` / `:v/pat/cmd` | Global / inverse-global |
| `:[range]norm <cmd>` | Execute normal-mode commands on a range |
| `:r <file>` | Read file into buffer |
| `:saveas <file>` | Save as new file |
| `:bn` / `:bp` / `:b <n>` / `:ls` | Buffer navigation |
| `:reg` / `:marks` | Show registers / marks |
| `:grep <pat> [path] [glob]` | Recursive grep |
| `:diff <file1> [file2]` | Compare two files, or buffer vs file on disk |
| `:pwd` / `:cd <dir>` | Working directory |
| `:terminal [cmd]` / `:termal [cmd]` | Open VS Code terminal (optionally run command) |
| `:!<cmd>` / `:[range]!<cmd>` | Shell command / filter through shell |

### Normal Mode

`i` `a` `I` `A` `o` `O` — insert mode entry  
`V` — visual line mode (select lines, then `=` to reindent)  
`dd` `yy` `p` `P` — delete, yank, put (with named registers: `"ayy`, `"ap`)  
`>>` `<<` — indent line right/left (respects `shiftwidth`)  
`j` `k` `gg` `G` `0` `$` — movement  
`ma` `'a` — set mark, jump to mark  
Count prefixes work: `3dd`, `5j`, `3>>`

### Visual Line Mode (`V`)

`V` — enter visual line mode at current line  
`G` `gg` `j` `k` — extend selection  
`=` — reindent selected lines and return to normal  
`Esc` — cancel and return to normal  
Example: `ggVG=` reindents the entire file

### Ranges

`%` (whole file), `.` (current line), `$` (last line), `'a` (mark), `/pattern/` (search forward)

## Supported LLM Backends

| Backend | Type | Default URL | Notes |
|---------|------|-------------|-------|
| **llama.cpp** | Local | `localhost:8080` | GGUF models, SSE streaming |
| **vLLM** | Local/Remote | `localhost:8000` | OpenAI-compatible API |
| **Mistral AI** | Cloud | `api.mistral.ai` | Requires API key |

Set the backend with the `nimis.serverType` setting (`llama`, `vllm`, or `mistral`).

## Getting Started

### Prerequisites

A running LLM server. For local use with llama.cpp:

```bash
./server -m path/to/model.gguf -c 2048 --host 127.0.0.1 --port 8080
```

### Install

```bash
git clone https://github.com/dashtotherock/nimis.git
cd nimis
npm install
npm run compile
```

Press **F5** in VS Code to launch with the extension loaded.

### Usage

1. Click the **Nimis** icon in the Activity Bar
2. Check the connection status at the top of the chat panel
3. Describe your problem and press **Ctrl+Enter**
4. Toggle the **Vim** button to watch the AI edit in real time

## Configuration

All settings live under the `nimis.*` namespace in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `nimis.serverType` | `llama` | Backend: `llama`, `vllm`, or `mistral` |
| `nimis.serverUrl` | (auto) | LLM server URL |
| `nimis.apiKey` | | API key for cloud providers |
| `nimis.model` | | Model name or path |
| `nimis.temperature` | `0.7` | Sampling temperature (0–2) |
| `nimis.maxTokens` | `2048` | Max tokens to generate (1–32768) |
| `nimis.mcpServers` | `[]` | MCP server configurations |
| `nimis.rules` | `[]` | Inline rule definitions |
| `nimis.rulesPaths` | `[]` | Paths to rule files |
| `nimis.benchPath` | `""` | Absolute path to bench.json (e.g. ~/bench/bench.json) |
| `nimis.bench` | `null` | Inline bench config (alternative to benchPath) |

## Commands

| Command | Description |
|---------|-------------|
| `Nimis: Open Chat` | Open the chat sidebar |
| `Nimis: Explain Selected Code` | Explain selected code in the editor |
| `Nimis: Insert Code at Cursor` | Insert AI-generated code at cursor |
| `Nimis: Run Bench` | Run all AI benchmark tests |
| `Nimis: Run Bench Test` | Run a single bench test (pick from list) |

### Bench

Bench runs the AI against problem definitions (e.g. LeetCode-style). Each test has a `.md` prompt file and an output path. The AI uses Vim tool calls to solve and save the solution. Configure via `nimis.benchPath` (path to bench.json) or `nimis.bench` (inline JSON).

**bench.json:**
```json
{
  "tests": [
    {
      "id": "two_sum",
      "promptPath": "two_sum/two_sum.md",
      "outputPath": "outputs/two_sum/solution.py",
      "timeout": 120000
    }
  ]
}
```

## Project Structure

```
nimis/
├── src/
│   ├── extension.ts                 # Entry point
│   ├── toolExecutor.ts              # Tool dispatch (vim → native → MCP)
│   ├── mcpManager.ts                # MCP server orchestration
│   ├── rulesManager.ts              # Rule loading and matching
│   ├── api/
│   │   ├── llmClient.ts            # ILLMClient interface
│   │   ├── llamaClient.ts          # llama.cpp client
│   │   ├── vllmClient.ts           # vLLM client
│   │   ├── mistralClient.ts        # Mistral AI client
│   │   ├── nativeToolServer.ts     # Native tool registration
│   │   ├── vimToolServer.ts        # Vim tool registration
│   │   ├── mcpToolServer.ts        # MCP tool registration
│   │   └── ruleServer.ts           # Rule server
│   ├── utils/
│   │   ├── nimisManager.ts         # Prompt building and state
│   │   ├── nimisStateTracker.ts    # Session persistence
│   │   ├── responseParser.ts       # LLM response parsing
│   │   ├── HarmonyParser.ts        # Structured output protocol
│   │   ├── toolCallExtractor.ts    # XML tool call extraction
│   │   ├── nativeToolManager.ts    # File and terminal tools
│   │   ├── editFileHandler.ts      # Precise text replacement
│   │   ├── bench/                  # Bench (types, loader, runner)
│   │   └── vim/                    # Vim subsystem
│   │       ├── VimToolManager.ts   # Singleton orchestrator
│   │       ├── models/             # VimBuffer, VimMode, VimRegister
│   │       ├── commands/           # StateMachine, ExHandler, NormalHandler
│   │       ├── operations/         # File, Text, Buffer, Grep, Directory ops
│   │       └── utils/              # RangeParser, PathResolver
│   └── webview/
│       ├── provider.ts             # Webview provider and LLM loop
│       └── assets/                 # main.js, vimView.js, markdownFormatter.js, styles.css
├── test/                            # ~56 test files (Vim, parsers, tools, provider)
├── package.json
├── webpack.config.js
└── tsconfig.json
```

## Development

```bash
npm run compile        # Production build
npm run watch          # Development watch mode
npm test               # Run tests
npm run test:coverage  # Tests with coverage
```

### Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

## License

MIT
