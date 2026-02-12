#!/usr/bin/env node

/**
 * IMPORTANT: Check README.md first for project configuration, team structure, and usage examples
 *
 * PaddockPal Jira MCP Server
 *
 * Available Tools:
 * 1. list_issue_types: List all available issue types in Jira
 *    - No parameters required
 *
 * 2. get_user: Get a user's account ID by email address
 *    - Required: email (string)
 *
 * 3. create_project: Create a new Jira project
 *    - Required: key (string), name (string), projectTypeKey (string), leadAccountId (string)
 *    - Optional: description (string), projectTemplateKey (string)
 *
 * 4. create_issue: Create a new Jira issue or subtask
 *    - Required: projectKey (string), summary (string), issueType (string)
 *    - Optional: description (string), assignee (string), labels (string[]),
 *               components (string[]), priority (string), parent (string)
 *
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import JiraClient from "jira-client";
import "dotenv/config";

/**
 * Default project configuration from README.md
 */
const DEFAULT_PROJECT = {
  KEY: "CPG",
  ID: "10000",
  NAME: "Website MVP",
  TYPE: "software",
  ENTITY_ID: "e01e939e-8442-4967-835d-362886c653e3",
};

/**
 * Default project manager configuration from README.md
 */
const DEFAULT_MANAGER = {
  EMAIL: "ghsstephens@gmail.com",
  ACCOUNT_ID: "712020:dc572395-3fef-4ee3-a31c-2e1b288c72d6",
  NAME: "George",
};

interface JiraField {
  id: string;
  name: string;
  required: boolean;
  schema: {
    type: string;
    system?: string;
    custom?: string;
    customId?: number;
  };
}

interface JiraIssueType {
  id: string;
  name: string;
  fields: Record<string, JiraField>;
}

/**
 * Environment variables required for Jira API authentication:
 * - JIRA_HOST: Jira instance hostname (e.g., paddock.atlassian.net)
 * - JIRA_EMAIL: User's email address for authentication
 * - JIRA_API_TOKEN: API token from https://id.atlassian.com/manage-profile/security/api-tokens
 */
const JIRA_HOST = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_AUTH_TYPE = process.env.JIRA_AUTH_TYPE || "basic";
const JIRA_API_VERSION = process.env.JIRA_API_VERSION || "3";

if (!JIRA_HOST || !JIRA_API_TOKEN) {
  throw new Error(
    "Missing required environment variables: JIRA_HOST and JIRA_API_TOKEN are required"
  );
}

if (JIRA_AUTH_TYPE === "basic" && !JIRA_EMAIL) {
  throw new Error(
    "Missing required environment variable for basic auth: JIRA_EMAIL is required"
  );
}

/**
 * Interface definitions for Jira API requests
 */

/**
 * Arguments for creating a new Jira issue or subtask
 * @property projectKey - Key of the project to create the issue in
 * @property summary - Issue title/summary
 * @property issueType - Type of issue (e.g., "Task", "Story", "Subtask")
 * @property description - Optional detailed description
 * @property assignee - Optional email of user to assign
 * @property labels - Optional array of labels to apply
 * @property components - Optional array of component names
 * @property priority - Optional priority level
 * @property parent - Optional parent issue key (required for subtasks)
 */
interface CreateIssueArgs {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  priority?: string;
  parent?: string;
  customFields?: Record<string, any>;
  useRawDescription?: boolean;
}

interface GetIssuesArgs {
  projectKey: string;
  jql?: string;
}

interface GetIssueCreateMetaArgs {
  projectKey: string;
  issueType: string;
  expand?: string;
}

interface UpdateIssueArgs {
  issueKey: string;
  summary?: string;
  description?: string;
  assignee?: string;
  status?: string;
  priority?: string;
  customFields?: Record<string, any>;
  useRawDescription?: boolean;
  labels?: string[];
}

interface CreateIssueLinkArgs {
  inwardIssueKey: string;
  outwardIssueKey: string;
  linkType: string;
}

/**
 * Arguments for getting a user's account ID
 * @property email - Email address of the user to look up
 */
interface GetUserArgs {
  email: string;
}

/**
 * Represents a Jira issue type with its properties
 * @property id - Unique identifier for the issue type
 * @property name - Display name of the issue type
 * @property description - Optional description of when to use this type
 * @property subtask - Whether this is a subtask type
 */
interface IssueType {
  id: string;
  name: string;
  description?: string;
  subtask: boolean;
}

/**
 * Represents a custom field value option
 */
interface CustomFieldOption {
  id: string;
  value: string;
}

/**
 * Parse user mentions in free text and convert to Jira Cloud ADF mention nodes.
 * Supports formats:
 *  - <@accountId:712020:abc-123>  (explicit accountId)
 *  - <@email:user@example.com>    (email lookup to accountId)
 *  - <@legacy:557058:xyz>         (legacy style, kept for backward compatibility)
 */
async function replaceMentionsWithADF(text: string, jira: JiraClient) {
  if (!text) return text;

  // Matches <@type:value> where type is accountId|email|legacy (default to email if @ is present)
  const mentionRegex = /<@\s*(accountId|email|legacy)?\s*:\s*([^>]+)>/g;

  const replacements: Array<{ placeholder: string; node: any }> = [];

  const uniqueMatches = new Map<string, { type: string; value: string }>();
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const raw = match[0];
    const type = (match[1] || "email").toLowerCase();
    const value = match[2].trim();
    uniqueMatches.set(raw, { type, value });
  }

  // Resolve each unique mention to an accountId and displayName
  const resolved = new Map<string, { accountId: string; text: string }>();
  for (const [raw, { type, value }] of uniqueMatches.entries()) {
    try {
      if (type === "accountId" || type === "legacy") {
        // Directly use as accountId; Jira Cloud account IDs can include a colon
        resolved.set(raw, { accountId: value, text: "@user" });
      } else {
        // email -> lookup
        const users = await jira.searchUsers({ query: value, includeActive: true, maxResults: 1 });
        if (users && users.length > 0) {
          resolved.set(raw, { accountId: users[0].accountId, text: `@${users[0].displayName}` });
        }
      }
    } catch (e) {
      // skip unresolved
    }
  }

  // Build an ADF paragraph where we splice text and mention nodes
  const parts: any[] = [];
  let lastIndex = 0;
  mentionRegex.lastIndex = 0;
  while ((match = mentionRegex.exec(text)) !== null) {
    const start = match.index;
    const end = mentionRegex.lastIndex;
    const raw = match[0];

    if (start > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, start) });
    }

    const res = resolved.get(raw);
    if (res) {
      parts.push({ type: "mention", attrs: { id: res.accountId, accessLevel: "CONTAINER" }, text: res.text });
    } else {
      // fallback to plain text
      parts.push({ type: "text", text: raw });
    }

    lastIndex = end;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }

  return {
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: parts.length ? parts : [{ type: "text", text }],
      },
    ],
  };
}



/**
 * Converts plain text to Atlassian Document Format (ADF)
 * Used for formatting issue descriptions in Jira's rich text format
 * @param text - Plain text to convert to ADF
 * @returns ADF document object with the text content
 */
function convertToADF(text: string) {
  const lines = text.split("\n");
  const content: any[] = [];
  let currentList: any = null;
  let currentListType: "bullet" | "ordered" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || "";

    // Skip empty lines between paragraphs
    if (line.trim() === "") {
      currentList = null;
      currentListType = null;
      continue;
    }

    // Handle bullet points
    if (line.trim().startsWith("- ")) {
      const listItem = line.trim().substring(2);
      if (currentListType !== "bullet") {
        currentList = {
          type: "bulletList",
          content: [],
        };
        content.push(currentList);
        currentListType = "bullet";
      }
      currentList.content.push({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: listItem,
              },
            ],
          },
        ],
      });
      continue;
    }

    // Handle numbered lists
    if (/^\d+\.\s/.test(line.trim())) {
      const listItem = line.trim().replace(/^\d+\.\s/, "");
      if (currentListType !== "ordered") {
        currentList = {
          type: "orderedList",
          content: [],
        };
        content.push(currentList);
        currentListType = "ordered";
      }
      currentList.content.push({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: listItem,
              },
            ],
          },
        ],
      });
      continue;
    }

    // Handle headings (lines ending with ":")
    if (line.trim().endsWith(":") && nextLine.trim() === "") {
      content.push({
        type: "heading",
        attrs: { level: 3 },
        content: [
          {
            type: "text",
            text: line.trim(),
          },
        ],
      });
      continue;
    }

    // Regular paragraph
    currentList = null;
    currentListType = null;
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: line,
        },
      ],
    });
  }

  return {
    version: 1,
    type: "doc",
    content,
  };
}

class JiraServer {
  private readonly server: Server;
  private readonly jira: JiraClient;
  private readonly toolDefinitions = {
    delete_issue: {
      description: "Delete a Jira issue or subtask",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to delete",
          },
        },
        required: ["issueKey"],
      },
    },
    get_issues: {
      description: "Get all issues and subtasks for a Jira project",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: 'Project key (e.g., "PP")',
          },
          jql: {
            type: "string",
            description: "Optional JQL to filter issues",
          },
        },
        required: ["projectKey"],
      },
    },
    get_issue_create_meta: {
      description: "Get Jira 'create issue' metadata (required fields + allowed values) for a project and issue type",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key (e.g. 'CPG')",
          },
          issueType: {
            type: "string",
            description: "Issue type name (e.g. 'Task' or 'Intervention')",
          },
        },
        required: ["projectKey", "issueType"],
      },
    },
    update_issue: {
      description: "Update an existing Jira issue",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Key of the issue to update",
          },
          summary: {
            type: "string",
            description: "New summary/title",
          },
          description: {
            type: "string",
            description: "New description",
          },
          assignee: {
            type: "string",
            description: "Email of new assignee",
          },
          status: {
            type: "string",
            description: "New status",
          },
          priority: {
            type: "string",
            description: "New priority",
          },
          customFields: {
            type: "object",
            description: "Optional custom fields as key-value pairs. Same format as create_issue.",
          },
          useRawDescription: {
            type: "boolean",
            description: "If true, use plain text for description instead of ADF format. Use this if your Jira instance doesn't support ADF.",
          },
          labels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Array of labels to apply (replaces existing labels)",
          }
        },
        required: ["issueKey"],
      },
    },
    list_fields: {
      description: "List all available Jira fields",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    list_issue_types: {
      description: "List all available Jira issue types",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Optional project key to filter issue types by project",
          },
        },
        required: [],
      },
    },
    list_link_types: {
      description: "List all available issue link types",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    get_user: {
      description: "Get a user's account ID by email address",
      inputSchema: {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "User's email address",
          },
        },
        required: ["email"],
      },
    },
    search_users: {
      description: "Search for Jira users by name or email to find their account ID/username",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Name or email of the user (e.g. 'George' or 'George Dupont')"
          }
        },
        required: ["query"]
      }
    },
    list_project_users: {
      description: "List all users/members assigned to a specific project",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Project key (e.g. EXPLOIT)"
          }
        },
        required: ["projectKey"]
      }
    },
    create_issue: {
      description: "Create a new Jira issue",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: 'Project key (e.g., "PP")',
          },
          summary: {
            type: "string",
            description: "Issue summary/title",
          },
          issueType: {
            type: "string",
            description: 'Type of issue (e.g., "Task", "Bug", "Story")',
          },
          description: {
            type: "string",
            description: "Detailed description of the issue",
          },
          assignee: {
            type: "string",
            description: "Email of the assignee",
          },
          labels: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Array of labels to apply",
          },
          components: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Array of component names",
          },
          priority: {
            type: "string",
            description: "Issue priority",
          },
          customFields: {
            type: "object",
            description: "Optional custom fields as key-value pairs. For select fields, use {id: 'optionId'} or {value: 'optionValue'}. For multiselect, use [{id: 'id1'}, {id: 'id2'}]. Example: {'customfield_11553': {id: '10001'}, 'customfield_14550': [{id: '10002'}]}",
          },
          useRawDescription: {
            type: "boolean",
            description: "If true, use plain text for description instead of ADF format. Use this if your Jira instance doesn't support ADF.",
          },
        },
        required: ["projectKey", "summary", "issueType"],
      },
    },
    create_issue_link: {
      description: "Create a link between two issues",
      inputSchema: {
        type: "object",
        properties: {
          inwardIssueKey: {
            type: "string",
            description: "Key of the inward issue (e.g., blocked issue)",
          },
          outwardIssueKey: {
            type: "string",
            description: "Key of the outward issue (e.g., blocking issue)",
          },
          linkType: {
            type: "string",
            description: "Type of link (e.g., 'blocks')",
          },
        },
        required: ["inwardIssueKey", "outwardIssueKey", "linkType"],
      },
    },
  };

  constructor() {
    this.server = new Server(
      {
        name: "jira-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
      }
    );

    const jiraConfig: JiraClient.JiraApiOptions = {
      protocol: "https",
      host: JIRA_HOST as string,
      apiVersion: JIRA_API_VERSION,
      strictSSL: true,
    };

    if (JIRA_AUTH_TYPE === "bearer") {
      jiraConfig.bearer = JIRA_API_TOKEN as string;
    } else {
      jiraConfig.username = JIRA_EMAIL as string;
      jiraConfig.password = JIRA_API_TOKEN as string;
    }

    this.jira = new JiraClient(jiraConfig);

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async findUser(query: string): Promise<any[]> {
    const uri = (this.jira as any).makeUri({
      pathname: '/user/search',
      query: { username: query, query: query }
    });
    return await (this.jira as any).doRequest((this.jira as any).makeRequestHeader(uri));
  }

  private validateDeleteIssueArgs(args: unknown): args is { issueKey: string } {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { issueKey } = args as { issueKey?: string };

    if (typeof issueKey !== "string" || issueKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Issue key is required and must be a string"
      );
    }

    return true;
  }

  private validateCreateIssueArgs(args: unknown): args is CreateIssueArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { projectKey, summary, issueType } = args as Partial<CreateIssueArgs>;

    if (typeof projectKey !== "string" || projectKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project key is required and must be a string"
      );
    }

    if (typeof summary !== "string" || summary.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Summary is required and must be a string"
      );
    }

    if (typeof issueType !== "string" || issueType.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Issue type is required and must be a string"
      );
    }

    return true;
  }

  private validateGetUserArgs(args: unknown): args is GetUserArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { email } = args as Partial<GetUserArgs>;

    if (typeof email !== "string" || email.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Email is required and must be a string"
      );
    }

    return true;
  }

  private validateGetIssuesArgs(args: unknown): args is GetIssuesArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { projectKey } = args as Partial<GetIssuesArgs>;

    if (typeof projectKey !== "string" || projectKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project key is required and must be a string"
      );
    }

    return true;
  }

  private validateGetIssueCreateMetaArgs(args: unknown): args is GetIssueCreateMetaArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
    }

    const { projectKey, issueType, expand } = args as Partial<GetIssueCreateMetaArgs>;

    if (typeof projectKey !== "string" || projectKey.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "projectKey is required and must be a string");
    }

    if (typeof issueType !== "string" || issueType.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "issueType is required and must be a string");
    }

    if (expand !== undefined && typeof expand !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "expand must be a string if provided");
    }
    return true;
  }

  private validateUpdateIssueArgs(args: unknown): args is UpdateIssueArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { issueKey } = args as Partial<UpdateIssueArgs>;

    if (typeof issueKey !== "string" || issueKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Issue key is required and must be a string"
      );
    }

    return true;
  }

  private validateCreateIssueLinkArgs(
    args: unknown
  ): args is CreateIssueLinkArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { inwardIssueKey, outwardIssueKey, linkType } =
      args as Partial<CreateIssueLinkArgs>;

    if (typeof inwardIssueKey !== "string" || inwardIssueKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Inward issue key is required and must be a string"
      );
    }

    if (typeof outwardIssueKey !== "string" || outwardIssueKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Outward issue key is required and must be a string"
      );
    }

    if (typeof linkType !== "string" || linkType.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Link type is required and must be a string"
      );
    }

    return true;
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(this.toolDefinitions).map(([name, def]) => ({
        name,
        ...def,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "list_fields": {
            const response = await this.jira.listFields();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(response, null, 2),
                },
              ],
            };
          }

          case "list_link_types": {
            const response = await this.jira.listIssueLinkTypes();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(response, null, 2),
                },
              ],
            };
          }

          case "list_issue_types": {
            let response;
            if (
              request.params.arguments &&
              typeof request.params.arguments === "object" &&
              "projectKey" in request.params.arguments
            ) {
              // Get issue types for specific project
              const projectKey = request.params.arguments.projectKey as string;

              // First get all issue types
              const allIssueTypesRaw = await this.jira.listIssueTypes();
              const allIssueTypes: IssueType[] = Array.isArray(allIssueTypesRaw)
                ? allIssueTypesRaw
                : (allIssueTypesRaw?.issueTypes ?? allIssueTypesRaw?.values ?? []);
              // Then get the project to find which issue types are associated with it
              try {
                const project = await this.jira.getProject(projectKey);
                if (project && project.issueTypes) {
                  // Filter issue types to only those in the project
                  const projectIssueTypeIds = project.issueTypes.map((t: any) => t.id);
                  response = allIssueTypes.filter((type: IssueType) =>
                    projectIssueTypeIds.includes(type.id)
                  );
                } else {
                  response = allIssueTypes;
                }
              } catch (error) {
                // If there's an error getting the project, fall back to all issue types
                console.error(`Error getting project ${projectKey}:`, error);
                response = allIssueTypes;
              }
            } else {
              // Get all issue types
              response = await this.jira.listIssueTypes();
            }
            const responseArr: IssueType[] = Array.isArray(response)
              ? response
              : (response?.issueTypes ?? response?.values ?? []);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    responseArr.map((type: IssueType) => ({
                      id: type.id,
                      name: type.name,
                      description: type.description,
                      subtask: type.subtask,
                    })),
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // You have to be ADMIN to use this
          case "list_project_users": {
            const args = request.params.arguments as any;
            if (!args.projectKey) throw new McpError(ErrorCode.InvalidParams, "projectKey required");

            try {
              const rolesPath = `/project/${args.projectKey}/role`;
              const rolesUri = (this.jira as any).makeUri({ pathname: rolesPath });
              const roles = await (this.jira as any).doRequest((this.jira as any).makeRequestHeader(rolesUri));

              const allUsers = new Map();

              for (const roleName in roles) {
                const roleUrl = roles[roleName];
                const response = await (this.jira as any).doRequest((this.jira as any).makeRequestHeader(roleUrl));

                if (response.actors) {
                  response.actors.forEach((actor: any) => {
                    if (actor.type === "atlassian-user-role-actor") {
                      allUsers.set(actor.name, {
                        displayName: actor.displayName,
                        name: actor.name,
                        accountId: actor.actorUser?.accountId
                      });
                    }
                  });
                }
              }

              return {
                content: [{
                  type: "text",
                  text: JSON.stringify(Array.from(allUsers.values()), null, 2)
                }]
              };
            } catch (error: any) {
              return {
                content: [{ type: "text", text: `Error listing users: ${error.message}` }],
                isError: true
              };
            }
          }

          case "get_issues": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }

            const unknownArgs = request.params.arguments as unknown;
            this.validateGetIssuesArgs(unknownArgs);
            const args = unknownArgs as GetIssuesArgs;

            const jql = args.jql
              ? `project = ${args.projectKey} AND ${args.jql}`
              : `project = ${args.projectKey}`;

            const response = await this.jira.searchJira(jql, {
              maxResults: 100,
              fields: [
                "summary",
                "description",
                "status",
                "priority",
                "assignee",
                "issuetype",
                "parent",
                "subtasks",
                "labels",
              ],
            });

            const issues = response.issues || [];
            const processedIssues = issues.map((issue: any) => {
              if (
                issue.fields.description &&
                typeof issue.fields.description === "object"
              ) {
                issue.fields.description = JSON.stringify(
                  issue.fields.description,
                  null,
                  2
                );
              }
              return issue;
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(processedIssues, null, 2),
                },
              ],
            };
          }

          case "search_users": {
            const args = request.params.arguments as any;
            const users = await this.findUser(args.query);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(users.map((u: any) => ({
                  displayName: u.displayName,
                  emailAddress: u.emailAddress,
                  key: u.key,
                  name: u.name
                })), null, 2)
              }]
            };
          }

          case "get_issue_create_meta": {
            if (!request.params.arguments || typeof request.params.arguments !== "object") {
              throw new McpError(ErrorCode.InvalidParams, "Arguments are required");
            }

            const args = request.params.arguments as any;
            this.validateGetIssueCreateMetaArgs(args);

            try {
              const allTypesRaw = await this.jira.listIssueTypes();
              const allTypes = Array.isArray(allTypesRaw) ? allTypesRaw : (allTypesRaw?.values ?? []);
              const targetType = allTypes.find((t: any) => t.name.toLowerCase() === args.issueType.toLowerCase());

              if (!targetType) {
                throw new Error(`The type '${args.issueType}' has not been found.`);
              }

              const apiPath = `/issue/createmeta/${args.projectKey}/issuetypes/${targetType.id}?expand=projects.issutypes.fields`;
              const response = await (this.jira as any).doRequest({
                method: 'GET',
                uri: (this.jira as any).makeUri({ pathname: apiPath }),
                json: true
              });

              const fieldList = Array.isArray(response.values) ? response.values : [];
              const requiredFields = fieldList
                .filter((f: any) => f.required)
                .map((f: any) => ({
                  id: f.fieldId,
                  name: f.name,
                  required: true,
                  schema: f.schema,
                }));


              const fieldsWithAllowedValues = fieldList
                .filter((f: any) => Array.isArray(f.allowedValues))
                .map((f: any) => ({
                  id: f.fieldId,
                  name: f.name,
                  required: !!f.required,
                  schema: f.schema,
                  allowedValues: f.allowedValues.map((v: any) => ({
                    id: v.id,
                    value: v.value ?? v.name,
                  })),
                }));

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        projectKey: args.projectKey,
                        issueType: args.issueType,
                        issueTypeId: targetType.id,
                        requiredFields,
                        fieldsWithAllowedValues,
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [{ type: "text", text: `Error Jira: ${error.message}` }],
                isError: true,
              };
            }
          }

          case "get_user": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }

            const unknownArgs = request.params.arguments as unknown;
            this.validateGetUserArgs(unknownArgs);
            const args = unknownArgs as GetUserArgs;

            const response = await this.jira.searchUsers({
              query: args.email,
              includeActive: true,
              maxResults: 1,
            });

            if (!response || response.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No user found with email: ${args.email}`,
                  },
                ],
                isError: true,
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      accountId: response[0].accountId,
                      displayName: response[0].displayName,
                      emailAddress: response[0].emailAddress,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case "create_issue": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }

            const unknownArgs = request.params.arguments as unknown;
            this.validateCreateIssueArgs(unknownArgs);
            const args = unknownArgs as CreateIssueArgs;

            const projectKey = args.projectKey || DEFAULT_PROJECT.KEY;

            // Prepare issue fields
            const issueFields: any = {
              project: { key: projectKey },
              summary: args.summary,
              issuetype: { name: args.issueType },
              labels: args.labels,
              components: args.components?.map((name) => ({ name })),
              priority: args.priority ? { name: args.priority } : undefined,
              parent: args.parent ? { key: args.parent } : undefined,
            };

            // Handle description - use raw text if specified, otherwise try ADF format
            if (args.description) {
              if (args.useRawDescription) {
                issueFields.description = args.description;
              } else {
                issueFields.description = await replaceMentionsWithADF(args.description, this.jira);
              }
            }

            // Handle assignee if provided
            if (args.assignee) {
              const users = await this.jira.searchUsers({
                query: args.assignee,
                includeActive: true,
                maxResults: 1,
              });
              if (users && users.length > 0) {
                issueFields.assignee = { accountId: users[0].accountId };
              }
            }

            // Add custom fields if provided
            if (args.customFields) {
              Object.entries(args.customFields).forEach(([key, value]) => {
                issueFields[key] = value;
              });
            }

            // Try to create issue with ADF description first
            try {
              const response = await this.jira.addNewIssue({
                fields: issueFields,
              });

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        message: "Issue created successfully",
                        issue: {
                          id: response.id,
                          key: response.key,
                          url: `https://${JIRA_HOST}/browse/${response.key}`,
                        },
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            } catch (error: any) {
              // Check if this is a description format error  
              const errorString = JSON.stringify(error);
              const hasDescriptionError = error.errors && error.errors.description;
              const isStringFormatError = errorString.includes("chaîne") ||
                errorString.includes("string") ||
                hasDescriptionError;

              if (args.description && !args.useRawDescription && isStringFormatError) {
                console.error("[create_issue] ADF format failed, retrying with plain text description");
                issueFields.description = args.description;

                try {
                  const response = await this.jira.addNewIssue({
                    fields: issueFields,
                  });

                  return {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify(
                          {
                            message: "Issue created successfully (with plain text description)",
                            issue: {
                              id: response.id,
                              key: response.key,
                              url: `https://${JIRA_HOST}/browse/${response.key}`,
                            },
                          },
                          null,
                          2
                        ),
                      },
                    ],
                  };
                } catch (retryError) {
                  // If the retry also fails, throw the original error
                  throw error;
                }
              }
              // If it's not a description error, rethrow
              throw error;
            }
          }

          case "update_issue": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }
            const unknownArgs = request.params.arguments as unknown;
            this.validateUpdateIssueArgs(unknownArgs);
            const args = unknownArgs as UpdateIssueArgs;

            try {
              await this.jira.findIssue(args.issueKey);
              const updateFields: any = {};

              if (args.summary) {
                updateFields.summary = args.summary;
              }
              if (args.description) {
                if (args.useRawDescription) {
                  updateFields.description = args.description;
                } else {
                  updateFields.description = await replaceMentionsWithADF(args.description, this.jira);
                }
              }
              if (args.assignee) {
                let users = await this.jira.searchUsers({
                  query: args.assignee,
                  maxResults: 1,
                });
                if (!users || users.length === 0) {
                  users = await this.findUser(args.assignee);
                }
                if (users && users.length > 0) {
                  const user = users[0];
                  const userIdentifier = user.name || user.accountId || user.key;
                  try {
                    const assigneeUri = (this.jira as any).makeUri({
                      pathname: `/issue/${args.issueKey}/assignee`
                    });

                    await (this.jira as any).doRequest({
                      method: 'PUT',
                      uri: assigneeUri,
                      body: { name: userIdentifier },
                      json: true
                    });

                  } catch (assignError: any) {
                    throw new Error(`Error to assign an user : ${assignError.message}`);
                  }
                } else {
                  throw new Error(`User '${args.assignee} not found with : '${users}`)
                }
              }
              if (args.status) {
                const transitions = await this.jira.listTransitions(
                  args.issueKey
                );
                const transition = transitions.transitions.find(
                  (t: any) => t.name.toLowerCase() === args.status?.toLowerCase()
                );
                if (transition) {
                  await this.jira.transitionIssue(args.issueKey, {
                    transition: { id: transition.id },
                  });
                }
              }
              if (args.labels) {
                updateFields.labels = args.labels;
              }

              if (Object.keys(updateFields).length > 0) {
                await this.jira.updateIssue(args.issueKey, {
                  fields: updateFields,
                });
              }

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        message: "Issue updated successfully",
                        issue: {
                          key: args.issueKey,
                          url: `https://${JIRA_HOST}/browse/${args.issueKey}`,
                        },
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [{
                  type: "text",
                  text: `Update failed for ${args.issueKey}: ${error.message || JSON.stringify(error)}`
                }],
                isError: true
              };
            }
          }

          case "delete_issue": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }

            const unknownArgs = request.params.arguments as unknown;
            this.validateDeleteIssueArgs(unknownArgs);
            const { issueKey } = unknownArgs as { issueKey: string };

            await this.jira.deleteIssue(issueKey);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      message: "Issue deleted successfully",
                      issueKey,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case "create_issue_link": {
            if (
              !request.params.arguments ||
              typeof request.params.arguments !== "object"
            ) {
              throw new McpError(
                ErrorCode.InvalidParams,
                "Arguments are required"
              );
            }

            const unknownArgs = request.params.arguments as unknown;
            this.validateCreateIssueLinkArgs(unknownArgs);
            const args = unknownArgs as CreateIssueLinkArgs;

            await this.jira.issueLink({
              inwardIssue: { key: args.inwardIssueKey },
              outwardIssue: { key: args.outwardIssueKey },
              type: { name: args.linkType },
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      message: "Issue link created successfully",
                      link: {
                        inward: args.inwardIssueKey,
                        outward: args.outwardIssueKey,
                        type: args.linkType,
                      },
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        const errorMessage =
          error instanceof Error
            ? (error.message || JSON.stringify(error))
            : JSON.stringify(error);
        return {
          content: [{ type: "text", text: `Operation failed: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  }

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jira MCP server running on stdio");
  }
}
const jiraServer = new JiraServer();
jiraServer.run().catch((error: Error) => console.error(error));
