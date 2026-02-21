import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { NativeToolsManager, NativeToolResult } from "./utils/nativeToolManager";
import { VimToolManager } from "./utils/vim";
import { MCPClient } from "./mcpClient";
import type { MCPManager } from "./mcpManager";

/**
 * Executes a tool call, dispatching to vim tools, native tools, or MCP tools
 * in that priority order.
 *
 * @param toolCall - The tool call to execute (MCPToolCall interface)
 * @param options - Optional: pass managers/clients or override defaults
 */
export async function toolExecutor(
  toolCall: MCPToolCall,
  options?: {
    mcpManager?: MCPManager;
    mcpClient?: MCPClient;
    nativeToolManager?: NativeToolsManager;
    vimToolManager?: VimToolManager;
    prefer?: "native" | "mcp";
  }
): Promise<MCPToolResult> {
  const { mcpManager, mcpClient, nativeToolManager, vimToolManager } = options || {};
  const toolName = toolCall.name;
  const args = toolCall.arguments || {};

  console.log(`[toolExecutor] Executing tool call: ${toolName}`, args);

  // Check vim tools first
  if (vimToolManager) {
    const vimTools = vimToolManager.getAvailableTools().map(t => t.name);
    if (vimTools.includes(toolName)) {
      console.log(`[toolExecutor] Using vim tool: ${toolName}`);
      return await vimToolManager.callTool(toolName, args);
    }
  }

  // Then check native tools
  const nativeMgr = nativeToolManager || NativeToolsManager.getInstance();
  const nativeTools = nativeMgr.getAvailableTools().map(t => t.name);
  if (nativeTools.includes(toolName)) {
    console.log(`[toolExecutor] Using native tool: ${toolName}`);
    const result: NativeToolResult = await nativeMgr.callTool(toolName, args);
    return result;
  }

  // Then try MCP tool via MCPManager (supports multiple servers)
  if (mcpManager) {
    const serverName = mcpManager.findToolServer(toolName);
    if (serverName) {
      console.log(`[toolExecutor] Using MCP tool: ${toolName} (server: ${serverName})`);
      return await mcpManager.callTool(serverName, toolName, args);
    }
  }

  // Fallback: try single MCPClient if provided
  if (mcpClient && mcpClient.isConnected()) {
    const mcpTools = mcpClient.getAvailableTools().map(t => t.name);
    if (mcpTools.includes(toolName)) {
      console.log(`[toolExecutor] Using MCP tool: ${toolName}`);
      const result: MCPToolResult = await mcpClient.callTool(toolName, args);
      return result;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Tool '${toolName}' not found in vim, native, or MCP tools.`,
      },
    ],
    isError: true,
  };
}
