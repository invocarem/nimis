
# Nimis - AI Prototyping Extension

A VS Code extension for AI-powered code prototyping, tool execution, and rule-based automation using llama.cpp, MCP, and native tools.


## Features

- 💬 **Chat Interface**: Interactive sidebar chat with your AI model
- 🔄 **Streaming Responses**: Real-time streaming of AI responses
- 📝 **Code Insertion**: Insert AI-generated code directly into your editor
- 🔍 **Code Explanation**: Right-click on selected code to get explanations
- ⚙️ **Configurable**: Customize server URL, temperature, token limits, and more
- 🎨 **Rich Formatting**: Full markdown and code block formatting support
- 🛠️ **Tool Execution**: Call both native and MCP tools from chat or programmatically
- 📜 **Rule System**: Define and manage custom rules to automate workflows and guide LLM behavior
- 🧩 **Tool Extraction**: Robustly extract and execute tool calls from LLM responses
- 🤖 **MCP Integration**: Connect to multiple Model Context Protocol (MCP) servers for advanced tool orchestration


## Architecture Overview

The extension is modular and supports advanced AI-driven workflows:

- **Native Tools**: Run local tools (e.g., file operations, shell commands) securely from the extension or LLM.
- **MCP Tools**: Connect to external MCP servers for distributed tool execution and orchestration.
- **Rules**: Author custom rules (YAML/JSON/Markdown) to automate tasks, enforce policies, or guide LLM output.
- **Tool Extraction**: The tool extractor parses LLM responses for tool_call(...) patterns and executes them.
- **Tool Executor**: Central logic for dispatching tool calls to native or MCP tools.
- **Webview UI**: Rich chat interface for interacting with LLM, tools, and rules.

The extension now supports comprehensive formatting for LLM responses:

### Markdown Features

- **Headers**: H1, H2, H3 headings (# ## ###)
- **Text Styling**: **bold**, _italic_, `inline code`
- **Lists**: Ordered and unordered lists
- **Links**: Clickable links [text](url)
- **Paragraphs**: Proper paragraph spacing

### Code Blocks

- **Syntax Highlighting**: Language-specific code blocks with labels
- **Copy Button**: One-click copy for all code blocks
- **Insert Button**: Insert generated code directly at cursor
- **JSON Formatting**: Automatic pretty-printing of JSON code blocks
- **Multi-language Support**: JavaScript, TypeScript, Python, JSON, and more

Example code block:
\`\`\`javascript
function example() {
console.log("Code with syntax highlighting!");
}
\`\`\`


## Prerequisites

1. **llama.cpp server**: You need to have llama.cpp running with its HTTP server

   ```bash
   # Example: Running llama.cpp server
   ./server -m path/to/your/model.gguf -c 2048 --host 127.0.0.1 --port 8080
   ```

2. A compatible GGUF model file


## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press F5 to open a new VS Code window with the extension loaded


## Usage


### Starting the Chat

1. Click on the Nimis icon in the Activity Bar (left sidebar)
2. Make sure your llama.cpp server is running
3. Check the connection status at the top of the chat panel
4. Type your message and press Ctrl/Cmd+Enter or click Send


### Explaining Code

1. Select code in your editor
2. Right-click and select "Nimis: Explain Selected Code"
3. The chat panel will open with the code automatically inserted


### Tool Execution

You can call tools directly from the chat using the `tool_call` syntax:

```
tool_call(name="read_file", arguments={ "file_path": "src/index.ts" })
```

Both native and MCP tools are supported. The extension will extract and execute tool calls from LLM responses automatically.

### Rule System

Define custom rules to automate workflows, enforce coding standards, or guide LLM output. Rules can be managed via settings (`nimis.rules` and `nimis.rulesPaths`).

Example rule config:
```json
{
   "id": "require-docstring",
   "description": "All functions must have a docstring.",
   "enabled": true
}
```

Rules can be authored in Markdown, YAML, or JSON and loaded from files.

When the AI generates code blocks, an "Insert at Cursor" button will appear. Click it to insert the code at your cursor position.


## Configuration

Open VS Code settings and search for "Nimis":

- **nimis.llamaServerUrl**: URL of your llama.cpp server (default: `http://localhost:8080`)
- **nimis.mcpServers**: List of MCP servers for distributed tool execution
- **nimis.rules**: Array of custom rules (id, description, enabled, config)
- **nimis.rulesPaths**: Paths to rule files (Markdown/YAML/JSON)
- **nimis.temperature**: Sampling temperature (0-2, default: 0.7)
- **nimis.maxTokens**: Maximum tokens to generate (default: 2048)
- **nimis.model**: Optional model name or path


## Commands

- `Nimis: Open Chat` - Open the chat sidebar
- `Nimis: Explain Selected Code` - Explain selected code
- `Nimis: Insert Code at Cursor` - Insert code at cursor position
- `nimis.callNativeTool` - Call a native tool (internal)


## Development


### Project Structure

```
nimis/
├── src/
│   ├── extension.ts            # Extension entry point
│   ├── mcpManager.ts           # MCP server and tool orchestration
│   ├── rulesManager.ts         # Rule loading, watching, and management
│   ├── api/
│   │   ├── llamaClient.ts      # llama.cpp API client
│   │   ├── mcpToolServer.ts    # MCP tool server integration
│   │   ├── nativeToolServer.ts # Native tool server integration
│   │   └── ruleServer.ts       # Rule server integration
│   ├── utils/
│   │   ├── toolCallExtractor.ts # Extracts tool calls from LLM responses
│   │   ├── toolExecutor.ts      # Executes tool calls (native/MCP)
│   │   ├── nativeToolManager.ts # Manages native tools
│   │   ├── nimisManager.ts    # Nimis and prompt management
│   │   └── ...                  # Other utilities
│   └── webview/
│       ├── provider.ts         # Webview provider for chat UI
│       └── assets/             # Webview JS/CSS
├── package.json                # Extension manifest
└── tsconfig.json               # TypeScript configuration
```

### Building

```bash
# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch
```

### Packaging

```bash
npm install -g @vscode/vsce
vsce package
```


## Troubleshooting

### "Not connected to llama.cpp"

- Ensure llama.cpp server is running
- Check the server URL in settings matches your llama.cpp server
- Verify the server is accessible (try curl http://localhost:8080/health)

### Slow responses

- Reduce `maxTokens` in settings
- Use a smaller/faster model
- Increase your hardware resources

### Extension won't activate

- Check the Output panel (View > Output) and select "Nimis" from the dropdown
- Look for error messages in the Developer Tools console (Help > Toggle Developer Tools)


## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
