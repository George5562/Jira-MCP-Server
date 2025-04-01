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
const JIRA_API_VERSION = process.env.JIRA_API_VERSION || "3";
const JIRA_CUSTOM_FIELDS = process.env.JIRA_CUSTOM_FIELDS?.split(",") || [                "summary",
  "description",
  "status",
  "priority",
  "assignee",
  "issuetype",
  "parent",
  "subtasks"]

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  throw new Error(
    "Missing required environment variables: JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN are required"
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
  [key: string]: any;
}

interface GetIssuesArgs {
  projectKey: string;
  jql?: string;
}

interface UpdateIssueArgs {
  issueKey: string;
  summary?: string;
  description?: string;
  assignee?: string;
  status?: string;
  priority?: string;
  [key: string]: any;
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
      description: "Get all issues and subtasks for a project",
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
      description: "List all available issue types",
      inputSchema: {
        type: "object",
        properties: {},
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
          tools: this.toolDefinitions,
        },
      }
    );

    // Initialize Jira client
    this.jira = new JiraClient({
      protocol: "https",
      host: JIRA_HOST as string,
      username: JIRA_EMAIL as string,
      password: JIRA_API_TOKEN as string,
      apiVersion: JIRA_API_VERSION as string,
      strictSSL: true,
    });

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
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

          case "list_issue_types": {
            const response = await this.jira.listIssueTypes();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    response.map((type: IssueType) => ({
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
                ...JIRA_CUSTOM_FIELDS
              ],
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(response.issues, null, 2),
                },
              ],
            };
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
            const updateFields: any = {};

            // Process all fields from args dynamically
            Object.entries(args).forEach(([key, value]) => {
              // Skip undefined, null values and the issueKey (used for identifying the issue)
              if (value === undefined || value === null || key === 'issueKey') {
                return;
              }

              // Special handling for specific fields
              if (key === 'description') {
                // Handle description field format based on API version
                if (JIRA_API_VERSION === "2") {
                  updateFields[key] = value;
                } else {
                  updateFields[key] = convertToADF(value);
                }
              } else if (key === 'assignee') {
                // Assignee will be handled separately due to user lookup requirement
              } else if (key === 'status') {
                // Status will be handled separately via transitions
              } else if (key === 'priority') {
                updateFields[key] = { name: value };
              } else {
                // Default handling for all other fields
                updateFields[key] = value;
              }
            });

            // Handle assignee with user lookup if specified
            if (args.assignee) {
              const users = await this.jira.searchUsers({
                query: args.assignee,
                includeActive: true,
                maxResults: 1,
              });
              if (users && users.length > 0) {
                updateFields.assignee = { accountId: users[0].accountId };
              }
            }

            // Handle status transitions if specified
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

            const projectKey = args.projectKey;
            const assignee = args.assignee;
            const description = args.description;

            if(!projectKey) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Missing required projectKey parameter"
                  }
                ],
                isError: true
              };
            }

            if(!description) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Missing required description parameter"
                  }
                ],
                isError: true
              };
            }

            // First resolve the assignee account ID if it's an email
            let assigneeAccount = null;
            if (assignee && assignee.includes('@')) {
              const users = await this.jira.searchUsers({
                query: assignee,
                includeActive: true,
                maxResults: 1,
              });
              if (users && users.length > 0) {
                assigneeAccount = users[0];
              }
            }

            const descriptionConverted = convertToADF(description)

            // Handle description field format based on API version
            let descriptionField;
            if (JIRA_API_VERSION === "2") {
              // For API v2, use plain text description
              descriptionField = description;
            } else {
              // For API v3, use ADF format
              descriptionField = descriptionConverted;
            }

            // Build the fields object dynamically
            const fields: Record<string, any> = {
              project: { key: projectKey },
              issuetype: { name: args.issueType },
            };

            // Process all fields from args that are included in JIRA_CUSTOM_FIELDS
            Object.entries(args).forEach(([key, value]) => {
              // Skip undefined or null values and fields handled specially
              if (value === undefined || value === null || key === 'projectKey' || key === 'issueType') {
                return;
              }

              // Special handling for specific fields
              if (key === 'description') {
                fields[key] = descriptionField;
              } else if (key === 'assignee' && assigneeAccount) {
                fields[key] = assigneeAccount;
              } else if (key === 'issuetype') {
                fields.issuetype = { name: value };
              } else if (key === 'components' && Array.isArray(value)) {
                fields[key] = value.map((name) => ({ name }));
              } else if (key === 'priority' && typeof value === 'string') {
                fields[key] = { name: value };
              } else if (key === 'parent' && typeof value === 'string') {
                fields[key] = { key: value };
              } else {
                // Default handling for all other fields
                fields[key] = value;
              }
            });

            const response = await this.jira.addNewIssue({
              fields,
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
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        return {
          content: [
            { type: "text", text: `Operation failed: ${errorMessage}` },
          ],
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
