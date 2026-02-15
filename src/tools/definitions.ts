import type { Tool } from '@anthropic-ai/sdk/resources/messages.mjs';

export const TOOLS: Tool[] = [
  {
    name: 'list_dir',
    description:
      'List files and directories at a given path. Useful for exploring the codebase structure. Automatically filters out common build artifacts and hidden files.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to list (relative to target directory or absolute)',
        },
        max_depth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 3, max: 5)',
          default: 3,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_read',
    description:
      'Read the contents of a file with line numbers. For large files, you can specify a line range.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-indexed, optional)',
        },
        end_line: {
          type: 'number',
          description: 'Ending line number (inclusive, optional)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_search',
    description:
      'Search for a pattern (regex) across files in the codebase. Returns file paths, line numbers, and matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Path to search in (file or directory)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
          default: 50,
        },
      },
      required: ['pattern', 'path'],
    },
  },
  {
    name: 'update_blackboard',
    description:
      'Update a section of the blackboard with important findings. Use this to save key insights, patterns, or information you want to remember. Be concise and strategic with the available token budget.',
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            'Section name for organizing your findings (e.g., overview, architecture, patterns). You can use any name that makes sense for your analysis.',
        },
        content: {
          type: 'string',
          description: 'Content to add to the section',
        },
        replace: {
          type: 'boolean',
          description:
            'If true, replace the section content. If false, append to existing content. Default: false',
          default: false,
        },
      },
      required: ['section', 'content'],
    },
  },
];
