import * as vscode from 'vscode';
import { MCPManager } from "../mcpManager";
import { MCPTool, MCPToolResult } from "../mcpClient";

export class MCPToolServer {
  private mcpManager: MCPManager;

  constructor(mcpManager: MCPManager) {
    this.mcpManager = mcpManager;
  }

  getAvailableTools(): MCPTool[] {
    return this.mcpManager.getAllTools();
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    const serverName = this.mcpManager.findToolServer(toolName);
    if (!serverName) {
      throw new Error(`No MCP server found for tool: ${toolName}`);
    }
    return await this.mcpManager.callTool(serverName, toolName, args);
  }

  getConnectedServers(): string[] {
    return this.mcpManager.getConnectedServers();
  }
}

// Load MCP servers from user/workspace settings
const mcpServers = vscode.workspace.getConfiguration('nimis').get('mcpServers');
console.log('Loaded MCP Servers:', mcpServers);
