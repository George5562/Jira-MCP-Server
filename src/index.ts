#!/usr/bin/env node

/**
 * IMPORTANT: Check README.md first for project configuration, team structure, and usage examples
 *
 * Jira MCP Server
 *
 * This is the main entry point for the Jira MCP Server. It initializes the server and connects
 * to the Jira API using the provided environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import JiraClient from "jira-client";

// Import modules from the refactored structure
import { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } from "./config.js";
import { toolDefinitions } from "./tools.js";
import { JiraHandlers } from "./handlers.js";

/**
 * Main class for the Jira MCP Server
 */
class JiraServer {
  private readonly server: Server;
  private readonly jiraClient: JiraClient;
  private readonly handlers: JiraHandlers;

  constructor() {
    // Initialize the MCP server
    this.server = new Server(
      {
        name: "jira-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: toolDefinitions
        },
      }
    );

    // Initialize Jira client
    this.jiraClient = new JiraClient({
      protocol: "https",
      host: JIRA_HOST ?? "",  // Use nullish coalescing operator
      username: JIRA_EMAIL ?? "",  // Use nullish coalescing operator
      password: JIRA_API_TOKEN ?? "",  // Use nullish coalescing operator
      apiVersion: "3",
      strictSSL: true,
    });

    // Initialize handlers with the server and Jira client
    this.handlers = new JiraHandlers(this.server, this.jiraClient);
    
    // All tools are handled by the JiraHandlers class

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jira MCP Server started");
  }
}

/**
 * Main function to start the server
 */
async function main() {
  try {
    // Check for required environment variables
    if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      console.error("[ERROR] Missing required environment variables. Please set JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN.");
      process.exit(1);
    }
    
    // Create and start the server
    const server = new JiraServer();
    await server.start();
  } catch (error) {
    console.error("[ERROR] Failed to start Jira MCP Server:", error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("[FATAL] Unhandled error:", error);
  process.exit(1);
});
