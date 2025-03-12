/**
 * Configuration constants for the Jira MCP Server
 */

// Import dotenv to load environment variables from .env file
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only load environment variables from .env file if they're not already set
if (!process.env.JIRA_HOST || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
  console.log('Loading environment variables from .env file');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

/**
 * Environment variables required for Jira API authentication:
 * - JIRA_HOST: Jira instance hostname (e.g., paddock.atlassian.net)
 * - JIRA_EMAIL: User's email address for authentication
 * - JIRA_API_TOKEN: API token from https://id.atlassian.com/manage-profile/security/api-tokens
 */
export const JIRA_HOST = process.env.JIRA_HOST;
export const JIRA_EMAIL = process.env.JIRA_EMAIL;
export const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Validate required environment variables
if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  throw new Error(
    "Missing required environment variables: JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN are required"
  );
}

/**
 * Default project configuration from README.md
 */
export const DEFAULT_PROJECT = {
  KEY: "CPG",
  ID: "10000",
  NAME: "Website MVP",
  TYPE: "software",
  ENTITY_ID: "e01e939e-8442-4967-835d-362886c653e3",
};

/**
 * Default project manager configuration from README.md
 */
export const DEFAULT_MANAGER = {
  EMAIL: "ghsstephens@gmail.com",
  ACCOUNT_ID: "712020:dc572395-3fef-4ee3-a31c-2e1b288c72d6",
  NAME: "George",
};
