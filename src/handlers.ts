/**
 * Handler implementations for Jira MCP Server tools
 */

import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import JiraClient from "jira-client";

import { JIRA_HOST, DEFAULT_PROJECT, DEFAULT_MANAGER } from "./config.js";
import { convertToADF, getJiraFields, convertADFToMarkdown } from "./utils.js";
import { toolDefinitions } from "./tools.js";
import {
  CreateIssueArgs,
  CreateIssueLinkArgs,
  GetIssueArgs as GetIssuesArgs,
  GetUserArgs,
  IssueType,
  UpdateIssueArgs,
  ReadIssueResourceArgs,
} from "./types.js";

/**
 * Class containing all handler implementations for Jira MCP Server tools
 */
export class JiraHandlers {
  private readonly jira: JiraClient;

  constructor(private readonly server: Server, jiraClient: JiraClient) {
    this.jira = jiraClient;
    this.setupToolHandlers();
  }

  /**
   * Set up all tool handlers for the server
   */
  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(toolDefinitions).map(([name, def]) => ({
        name,
        ...def,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case "jira_list_fields": {
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

          case "jira_list_link_types": {
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

          case "jira_list_issue_types": {
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
            this.validateListIssueTypesArgs(unknownArgs);
            const args = unknownArgs as { projectKey?: string };

            let response;
            if (args.projectKey) {
              // Get issue types for specific project
              const projectKey = args.projectKey;
              
              // First get all issue types
              const allIssueTypes = await this.jira.listIssueTypes();
              
              // Then get the project to find which issue types are associated with it
              try {
                const project = await this.jira.getProject(projectKey);
                
                if (project?.issueTypes) {
                  // Filter issue types to only those in the project
                  const projectIssueTypeIds = project.issueTypes.map((t: any) => t.id);
                  
                  response = allIssueTypes.filter((type: IssueType) => 
                    projectIssueTypeIds.includes(type.id)
                  );
                } else {
                  response = allIssueTypes;
                }
              } catch (error) {
                console.error(`Error getting project ${projectKey}:`, error);
                response = allIssueTypes;
              }
            } else {
              // Get all issue types
              response = await this.jira.listIssueTypes();
            }
            
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

          case "jira_get_issues": {
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
              fields: getJiraFields(args.fieldSet ?? 'navigable'),
            });

            // Process each issue to convert ADF description to markdown
            if (response.issues && Array.isArray(response.issues)) {
              for (const issue of response.issues) {
                // Check if description exists and is in ADF format
                if (issue.fields?.description && typeof issue.fields.description === 'object') {
                  // Convert ADF to markdown
                  issue.fields.description = convertADFToMarkdown(issue.fields.description);
                }
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(response.issues, null, 2),
                },
              ],
            };
          }

          case "jira_update_issue": {
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

            if (args.summary) {
              updateFields.summary = args.summary;
            }
            if (args.description) {
              updateFields.description = convertToADF(args.description);
            }
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
            if (args.priority) {
              updateFields.priority = { name: args.priority };
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

          case "jira_get_user": {
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

          case "jira_read_issue": {
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
            this.validateReadIssueArgs(unknownArgs);
            const args = unknownArgs as ReadIssueResourceArgs;

            console.error(`[Tool] Reading issue: ${args.issueKey}`);
            const issue = await this.jira.getIssue(
              args.issueKey,
              getJiraFields(args.fieldSet ?? 'navigable'),
            );
            
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(issue, null, 2),
                },
              ],
            };
          }

          case "jira_create_issue": {
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

            const projectKey = args.projectKey ?? DEFAULT_PROJECT.KEY;
            const assignee = args.assignee ?? DEFAULT_MANAGER.EMAIL;

            const response = await this.jira.addNewIssue({
              fields: {
                project: { key: projectKey },
                summary: args.summary,
                issuetype: { name: args.issueType },
                description: args.description
                  ? convertToADF(args.description)
                  : undefined,
                assignee: { accountId: assignee },
                labels: args.labels,
                components: args.components?.map((name) => ({ name })),
                priority: args.priority ? { name: args.priority } : undefined,
                parent: args.parent ? { key: args.parent } : undefined,
              },
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

          case "jira_delete_issue": {
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

          case "jira_create_issue_link": {
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

  /**
   * Validate arguments for deleting an issue
   */
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

  /**
   * Validate arguments for creating an issue
   */
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

  /**
   * Validate arguments for getting a user
   */
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

  /**
   * Validate arguments for getting issues
   */
  private validateGetIssuesArgs(args: unknown): args is GetIssuesArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { projectKey, fieldSet } = args as Partial<GetIssuesArgs>;

    if (typeof projectKey !== "string" || projectKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project key is required and must be a string"
      );
    }

    // Validate fieldSet if provided
    if (fieldSet !== undefined && fieldSet !== 'basic' && fieldSet !== 'full' && fieldSet !== 'navigable') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Field set must be either 'basic', 'full', or 'navigable'"
      );
    }

    return true;
  }

  /**
   * Validate arguments for updating an issue
   */
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

  /**
   * Validate arguments for creating an issue link
   */
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

  /**
   * Validate arguments for reading an issue
   */
  private validateReadIssueArgs(args: unknown): args is ReadIssueResourceArgs {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { issueKey, fieldSet } = args as Partial<ReadIssueResourceArgs>;

    if (typeof issueKey !== "string" || issueKey.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Issue key is required and must be a string"
      );
    }

    // Validate fieldSet if provided
    if (fieldSet !== undefined && fieldSet !== 'basic' && fieldSet !== 'navigable' && fieldSet !== 'full') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Field set must be either 'basic', 'navigable', or 'full'"
      );
    }

    return true;
  }

  /**
   * Validate arguments for listing issue types
   */
  private validateListIssueTypesArgs(
    args: unknown
  ): args is { projectKey?: string } {
    if (typeof args !== "object" || args === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be an object"
      );
    }

    const { projectKey } = args as Partial<{ projectKey?: string }>;

    if (projectKey !== undefined && typeof projectKey !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project key must be a string"
      );
    }

    return true;
  }
}
