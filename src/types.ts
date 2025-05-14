/**
 * Interface definitions for Jira API requests and responses
 */

/**
 * Represents a Jira field with its properties
 */
export interface JiraField {
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

/**
 * Represents a Jira issue type with its properties
 */
export interface JiraIssueType {
  id: string;
  name: string;
  fields: Record<string, JiraField>;
}

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
export interface CreateIssueArgs {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  priority?: string;
  parent?: string;
}

/**
 * Arguments for getting issues from a project
 */
export interface GetIssueArgs {
  projectKey: string;
  jql?: string;
  fieldSet?: 'basic' | 'navigable' | 'full';
}

/**
 * Arguments for updating an existing issue
 */
export interface UpdateIssueArgs {
  issueKey: string;
  summary?: string;
  description?: string;
  assignee?: string;
  status?: string;
  priority?: string;
}

/**
 * Arguments for creating a link between two issues
 */
export interface CreateIssueLinkArgs {
  inwardIssueKey: string;
  outwardIssueKey: string;
  linkType: string;
}

/**
 * Arguments for getting a user's account ID
 * @property email - Email address of the user to look up
 */
export interface GetUserArgs {
  email: string;
}

/**
 * Represents a Jira issue type with its properties
 * @property id - Unique identifier for the issue type
 * @property name - Display name of the issue type
 * @property description - Optional description of when to use this type
 * @property subtask - Whether this is a subtask type
 */
export interface IssueType {
  id: string;
  name: string;
  description?: string;
  subtask: boolean;
}

/**
 * Arguments for reading a Jira issue as a resource
 */
export interface ReadIssueResourceArgs {
  issueKey: string;
  fieldSet?: 'basic' | 'navigable' | 'full';
}
