/**
 * Utility functions for the Jira MCP Server
 */

/**
 * Converts plain text to Atlassian Document Format (ADF)
 * Used for formatting issue descriptions in Jira's rich text format
 * @param text - Plain text to convert to ADF
 * @returns ADF document object with the text content
 */
export function convertToADF(text: string) {
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
    const numberedMatch = line.trim().match(/^(\d+)\. (.*)/);
    if (numberedMatch) {
      const listItem = numberedMatch[2];
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

    // Handle headings (lines followed by empty line or end of text)
    if (
      line.trim().length > 0 &&
      (nextLine.trim() === "" || i === lines.length - 1) &&
      !line.trim().endsWith(".") &&
      !line.trim().endsWith("?") &&
      !line.trim().endsWith("!") &&
      line.trim().length < 50
    ) {
      content.push({
        type: "heading",
        attrs: {
          level: 2,
        },
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

/**
 * Converts Atlassian Document Format (ADF) to Markdown
 * @param adf - ADF document object to convert to markdown
 * @returns Markdown string representation of the ADF content
 */
export function convertADFToMarkdown(adf: any): string {
  if (!adf || typeof adf !== 'object') {
    return '';
  }

  // Handle case where the full document is passed
  const content = adf.content || adf;
  
  if (!Array.isArray(content)) {
    return '';
  }

  return content.map((node: any) => processNode(node)).join('\n\n').trim();
}

/**
 * Process a single ADF node and convert it to markdown
 * @param node - ADF node to process
 * @returns Markdown string for the node
 */
function processNode(node: any): string {
  if (!node || !node.type) {
    return '';
  }

  switch (node.type) {
    case 'doc':
      return node.content ? node.content.map((n: any) => processNode(n)).join('\n\n') : '';
      
    case 'paragraph':
      return node.content ? node.content.map((n: any) => processNode(n)).join('') : '';
      
    case 'text':
      let text = node.text || '';
      
      // Apply text formatting
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'strong':
              text = `**${text}**`;
              break;
            case 'em':
              text = `*${text}*`;
              break;
            case 'code':
              text = `\`${text}\``;
              break;
            case 'strike':
              text = `~~${text}~~`;
              break;
            case 'link':
              text = `[${text}](${mark.attrs?.href || ''})`;
              break;
          }
        }
      }
      
      return text;
      
    case 'heading': {
      const level = node.attrs?.level || 1;
      const headingMarker = '#'.repeat(level);
      const headingContent = node.content ? node.content.map((n: any) => processNode(n)).join('') : '';
      return `${headingMarker} ${headingContent}`;
    }
      
    case 'bulletList':
      return node.content ? node.content.map((item: any) => processListItem(item, 'bullet')).join('\n') : '';
      
    case 'orderedList':
      return node.content ? node.content.map((item: any, index: number) => processListItem(item, 'ordered', index + 1)).join('\n') : '';
      
    case 'listItem':
      return node.content ? node.content.map((n: any) => processNode(n)).join('\n') : '';
      
    case 'codeBlock': {
      const language = node.attrs?.language || '';
      const code = node.content ? node.content.map((n: any) => processNode(n)).join('\n') : '';
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
      
    case 'blockquote': {
      const quoteContent = node.content ? node.content.map((n: any) => processNode(n)).join('\n\n') : '';
      return quoteContent.split('\n').map((line: string) => `> ${line}`).join('\n');
    }
      
    case 'rule':
      return '---';
      
    case 'table':
      return processTable(node);
      
    case 'image': {
      const alt = node.attrs?.alt || '';
      const src = node.attrs?.src || '';
      return `![${alt}](${src})`;
    }
      
    case 'hardBreak':
      return '\n';
      
    default:
      // For any other node types, try to process content if available
      return node.content ? node.content.map((n: any) => processNode(n)).join('') : '';
  }
}

/**
 * Process a table node
 * @param node - Table node
 * @returns Markdown string for the table
 */
function processTable(node: any): string {
  if (!node.content || !Array.isArray(node.content)) {
    return '';
  }
  
  const rows = node.content;
  if (rows.length === 0) {
    return '';
  }
  
  const tableRows: string[][] = [];
  
  // Process each row
  for (const row of rows) {
    if (!row.content || !Array.isArray(row.content)) {
      continue;
    }
    
    const cells: string[] = [];
    
    // Process each cell in the row
    for (const cell of row.content) {
      const cellContent = cell.content ? cell.content.map((n: any) => processNode(n)).join('') : '';
      cells.push(cellContent.replace(/\|/g, '\\|')); // Escape pipe characters
    }
    
    tableRows.push(cells);
  }
  
  if (tableRows.length === 0) {
    return '';
  }
  
  // Create markdown table
  const headerRow = tableRows[0];
  const separator = headerRow.map(() => '---');
  const bodyRows = tableRows.slice(1);
  
  const markdownRows = [
    `| ${headerRow.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...bodyRows.map((row: string[]) => `| ${row.join(' | ')} |`)
  ];
  
  return markdownRows.join('\n');
}

/**
 * Process a list item node
 * @param node - List item node
 * @param listType - Type of list ('bullet' or 'ordered')
 * @param index - Index for ordered lists
 * @returns Markdown string for the list item
 */
function processListItem(node: any, listType: 'bullet' | 'ordered', index?: number): string {
  const content = node.content ? node.content.map((n: any) => processNode(n)).join('') : '';
  const prefix = listType === 'bullet' ? '- ' : `${index}. `;
  
  // Handle nested lists by adding indentation
  return prefix + content.replace(/\n/g, '\n  ');
}

/**
 * Get the fields to request from Jira based on the field set
 * @param fieldSet The field set to use (basic, navigable, or full)
 * @returns Array of field names to request
 */
export function getJiraFields(fieldSet: 'basic' | 'navigable' | 'full' = 'navigable'): string[] {
  const FIELD_SETS: Record<string, string[]> = {
    basic: ["summary", "description", "status"],
    navigable: [
      "*navigable",
      "Rank"
    ],
    full: [
      "*navigable",
      "id",
      "key",
      "summary",
      "description",
      "status",
      "assignee",
      "reporter",
      "created",
      "updated",
      "resolutiondate",
      "parent",
      "subtasks",
      "issuelinks",
      "comment",
      "worklog",
      "Rank",
    ],
  };

  return FIELD_SETS[fieldSet] || FIELD_SETS.navigable;
}
