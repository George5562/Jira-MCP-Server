import { JiraServer } from './index.js';
import "dotenv/config";

const args = process.argv.slice(2);
const action = args[0];

async function run() {

  const server = new JiraServer();

  const jira = server.jira;

  console.log(`CLI Action: ${action}`);

  try {
    let result;

    switch (action) {
      case 'update':
        const updateKey = args[1];
        const fieldsJsonString = args[2];

        if (!updateKey || !fieldsJsonString) {
          throw new Error("Missing arguments. Usage: update <KEY> <JSON_FIELDS>");
        }

        let fieldsData;
        try {
          fieldsData = JSON.parse(fieldsJsonString);
        } catch (e) {
          throw new Error(`Invalid JSON arguments: ${fieldsJsonString}`);
        }

        console.log(`Updating ticket ${updateKey} with generic fields...`);

        await (jira as any).updateIssue(updateKey, { fields: fieldsData });

        result = { success: true, key: updateKey, updateKey, updateFields: Object.keys(fieldsData) };

        break;

      case 'create_issue':
        const projectKey = args[1];
        const summary = args[2];
        const description = args[3];

        console.log(`Creating the tick in ${projectKey}...`);

        const newIssue = await jira.addNewIssue({
          fields: {
            project: { key: projectKey },
            summary: summary,
            description: description,
            issuetype: { name: 'Task' }
          }
        });

        result = { success: true, key: newIssue.key, id: newIssue.id };
        break;

      case 'read':
        const readKey = args[1];

        console.log(`Reading full data for ${readKey}...`);
        const issue = await jira.findIssue(readKey);

        result = issue;

        break;

      default:
        console.error("Unkown action. Here are the actions available : assign, create_issue, read");
        process.exit(1);
    }
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error: any) {
    console.error(JSON.stringify({ error: error.message || error }));
    process.exit(1);
  }
}

run();
