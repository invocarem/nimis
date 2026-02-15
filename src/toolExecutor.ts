import { MCPToolCall, MCPToolResult } from "./mcpClient";
import { NativeToolsManager, NativeToolResult } from "./utils/nativeToolManager";
import { MCPClient } from "./mcpClient";
import type { MCPManager } from "./mcpManager";

/**
 * Executes a tool call, dispatching to either native tools or MCP tools.
 *
 * @param toolCall - The tool call to execute (MCPToolCall interface)
 * @param options - Optional: pass MCPManager or MCPClient for MCP tools, or override nativeToolManager
 */
export async function toolExecutor(
  toolCall: MCPToolCall,
  options?: {
    mcpManager?: MCPManager;
    mcpClient?: MCPClient;
    nativeToolManager?: NativeToolsManager;
    prefer?: "native" | "mcp";
  }
): Promise<MCPToolResult> {
  const { mcpManager, mcpClient, nativeToolManager } = options || {};
  const toolName = toolCall.name;
  const args = toolCall.arguments || {};

  // Log tool call execution
  console.log(`[toolExecutor] Executing tool call: ${toolName}`, args);
  // Always check native tools first
  const nativeMgr = nativeToolManager || new NativeToolsManager();
  const nativeTools = nativeMgr.getAvailableTools().map(t => t.name);
  if (nativeTools.includes(toolName)) {
    console.log(`[toolExecutor] Using native tool: ${toolName}`);
    const result: NativeToolResult = await nativeMgr.callTool(toolName, args);
    return result;
  }

  // If not found in native, try MCP tool via MCPManager (preferred, supports multiple servers)
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

  // Not found
  return {
    content: [
      {
        type: "text",
        text: `Tool '${toolName}' not found in native or MCP tools.`,
      },
    ],
    isError: true,
  };
}
