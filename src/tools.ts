/**
 * Tool definitions for the Jira MCP Server
 */

/**
 * Tool definitions for the Jira MCP Server
 * These tools provide functionality for interacting with Jira
 */
export const toolDefinitions = {
  jira_delete_issue: {
    description: "Delete a Jira issue or subtask",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: {
          type: "string",
          description: "Jira issue key to delete (e.g., 'PROJECT-123')",
        },
      },
      required: ["issueKey"],
    },
  },
  jira_get_issues: {
    description: "Get all issues and subtasks for a Jira project with optional JQL filtering",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: {
          type: "string",
          description: 'Jira project key (e.g., "PP" or "TEST")',
        },
        jql: {
          type: "string",
          description: "Optional Jira Query Language (JQL) to filter issues",
        },
        fieldSet: {
          type: "string",
          enum: ["basic", "navigable", "full"],
          description: "Optional field set to determine which fields to include in the response (default: 'navigable')",
        },
      },
      required: ["projectKey"],
    },
  },
  jira_update_issue: {
    description: "Update an existing Jira issue's fields",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: {
          type: "string",
          description: "Jira issue key to update (e.g., 'PROJECT-123')",
        },
        summary: {
          type: "string",
          description: "New summary/title for the Jira issue",
        },
        description: {
          type: "string",
          description: "New description for the Jira issue",
        },
        assignee: {
          type: "string",
          description: "Email of new assignee for the Jira issue",
        },
        status: {
          type: "string",
          description: "New status for the Jira issue",
        },
        priority: {
          type: "string",
          description: "New priority for the Jira issue",
        },
      },
      required: ["issueKey"],
    },
  },
  jira_list_fields: {
    description: "List all available fields in Jira for issue creation and updates",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  jira_list_issue_types: {
    description: "List all available Jira issue types with optional project filtering",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: {
          type: "string",
          description: "Optional Jira project key to filter issue types by project",
        },
      },
      required: [],
    },
  },
  jira_list_link_types: {
    description: "List all available Jira issue link types (e.g., blocks, is blocked by)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  jira_get_user: {
    description: "Get a Jira user's account ID by their email address",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Jira user's email address",
        },
      },
      required: ["email"],
    },
  },
  jira_create_issue: {
    description: "Create a new issue in Jira with specified fields",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: {
          type: "string",
          description: 'Jira project key (e.g., "PP" or "TEST")',
        },
        summary: {
          type: "string",
          description: "Summary/title for the new Jira issue",
        },
        issueType: {
          type: "string",
          description: 'Type of Jira issue (e.g., "Task", "Bug", "Story")',
        },
        description: {
          type: "string",
          description: "Detailed description for the new Jira issue",
        },
        assignee: {
          type: "string",
          description: "Email of the assignee for the new Jira issue",
        },
        labels: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Array of labels to apply to the new Jira issue",
        },
        components: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Array of Jira component names to include in the issue",
        },
        priority: {
          type: "string",
          description: "Priority level for the new Jira issue",
        },
      },
      required: ["projectKey", "summary", "issueType"],
    },
  },
  jira_create_issue_link: {
    description: "Create a link between two Jira issues (e.g., blocks, relates to)",
    inputSchema: {
      type: "object",
      properties: {
        inwardIssueKey: {
          type: "string",
          description: "Key of the inward Jira issue (e.g., blocked issue 'PROJECT-123')",
        },
        outwardIssueKey: {
          type: "string",
          description: "Key of the outward Jira issue (e.g., blocking issue 'PROJECT-456')",
        },
        linkType: {
          type: "string",
          description: "Type of Jira issue link (e.g., 'blocks', 'relates to')",
        },
      },
      required: ["inwardIssueKey", "outwardIssueKey", "linkType"],
    },
  },
  jira_read_issue: {
    description: "Read a single Jira issue, providing detailed information about the issue",
    inputSchema: {
      type: "object",
      properties: {
        issueKey: {
          type: "string",
          description: "Jira issue key to read (e.g., 'PROJECT-123')",
        },
        fieldSet: {
          type: "string",
          enum: ["basic", "navigable", "full"],
          description: "Optional field set to determine which fields to include in the response (default: 'navigable')",
        },
      },
      required: ["issueKey"],
    }
  },
};
