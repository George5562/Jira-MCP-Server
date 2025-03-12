/**
 * Reusable JQL query templates for the Jira MCP Server
 */
export const JqlPrompts = {
  /**
   * Filters for issue children by status
   */
  filterChildrenByStatus: `status in ("In Progress", "In Review")`,

  /**
   * Filters for issue children by assignee (current user)
   */
  filterChildrenByCurrentUser: `assignee = currentUser()`,

  /**
   * Filters for issue children by assignee (specific user)
   * @param userId The Jira account ID of the user
   */
  filterChildrenByUser: (userId: string) => `assignee = ${userId}`,

  /**
   * Filters for issue children by priority
   */
  filterChildrenByHighPriority: `priority in (Highest, High)`,

  /**
   * Filters for issue children by recent update
   * @param days Number of days to look back
   */
  filterChildrenByRecentUpdate: (days: number = 7) => `updated >= -${days}d`,

  /**
   * Finds issues with recent activity
   * @param projectKey The project key (e.g., 'BRAV')
   * @param days Number of days to look back
   */
  findRecentActivity: (projectKey: string, days: number = 14) =>
    `project = ${projectKey} AND updated >= -${days}d ORDER BY updated DESC`,

  /**
   * Finds blocked issues
   * @param projectKey The project key (e.g., 'BRAV')
   */
  findBlockedIssues: (projectKey: string) =>
    `project = ${projectKey} AND status = "Blocked" OR labels = blocked`,

  /**
   * Finds issues ready for development
   * @param projectKey The project key (e.g., 'BRAV')
   */
  findReadyForDevelopment: (projectKey: string) =>
    `project = ${projectKey} AND status = "Ready for Development" AND assignee is EMPTY`,

  /**
   * Finds issues needing review
   * @param projectKey The project key (e.g., 'BRAV')
   */
  findIssuesNeedingReview: (projectKey: string) =>
    `project = ${projectKey} AND status = "In Review" ORDER BY updated ASC`,

  /**
   * Finds issues by component
   * @param projectKey The project key (e.g., 'BRAV')
   * @param component The component name (e.g., 'Frontend')
   */
  findIssuesByComponent: (projectKey: string, component: string) =>
    `project = ${projectKey} AND component = "${component}"`,

  /**
   * Complex query example combining multiple filters
   * @param projectKey The project key (e.g., 'BRAV')
   * @param issueType The issue type (e.g., 'Story (Bravo)')
   */
  complexQueryExample: (projectKey: string, issueType: string) =>
    `project = ${projectKey} AND issuetype = "${issueType}" AND status in ("In Progress", "In Review") AND assignee = currentUser() AND updated >= -7d ORDER BY priority DESC, updated DESC`,

  /**
   * Finds issues for a specific epic
   * @param projectKey The project key (e.g., 'BRAV')
   * @param epicKey The epic key (e.g., 'BRAV-123')
   */
  findIssuesForEpic: (projectKey: string, epicKey: string) =>
    `project = ${projectKey} AND parent = ${epicKey}`,

  /**
   * Finds issues for a specific fix version
   * @param versionName The version name
   */
  findIssuesForFixVersion: (versionName: string) =>
    `fixVersion = "${versionName}"`,

  /**
   * Finds stories without epics
   * @param projectKey The project key (e.g., 'BRAV')
   * @param storyType The story type (e.g., 'Story (Bravo)')
   */
  findStoriesWithoutEpics: (projectKey: string, storyType: string) =>
    `project=${projectKey} AND issuetype="${storyType}" AND parent is EMPTY`,

  /**
   * Finds all epics
   * @param projectKey The project key (e.g., 'BRAV')
   * @param epicType The epic type (e.g., 'Epic (Bravo)')
   */
  findAllEpics: (projectKey: string, epicType: string) =>
    `project=${projectKey} AND issuetype="${epicType}"`,

  /**
   * Finds issues with pull requests
   * @param projectKey The project key (e.g., 'BRAV')
   * @param prStatus The PR status ('all', 'open', 'merged', or 'declined')
   */
  findIssuesWithPullRequests: (projectKey: string, prStatus: 'all' | 'open' | 'merged' | 'declined') =>
    `project = ${projectKey} AND development[pullrequests].${prStatus} > 0`,
};
