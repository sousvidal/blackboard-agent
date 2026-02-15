export interface SuggestedSection {
  name: string;
  description: string;
}

export interface AnalysisProfile {
  name: string;
  mission: string;
  initialMessage: string;
  suggestedSections: SuggestedSection[];
  explorationHints: string[];
  summaryInstructions: string;
}

const profiles = new Map<string, AnalysisProfile>();

export function registerProfile(profile: AnalysisProfile): void {
  profiles.set(profile.name, profile);
}

export function getProfile(name: string): AnalysisProfile | undefined {
  return profiles.get(name);
}

export function getAvailableProfiles(): string[] {
  return Array.from(profiles.keys());
}

export const CODEBASE_ANALYSIS_PROFILE: AnalysisProfile = {
  name: 'codebase-analysis',

  mission: `Explore and understand a software project systematically.

Build a comprehensive understanding by:
1. Exploring the file structure and organization
2. Identifying entry points and main components
3. Understanding the architecture and design patterns
4. Noting key dependencies and technologies
5. Identifying interesting patterns or potential concerns`,

  initialMessage: `Please analyze the codebase at: {{targetPath}}

Start by exploring the structure and identifying key components. Use your tools strategically and save important findings to the blackboard.`,

  suggestedSections: [
    {
      name: 'overview',
      description: 'High-level summary of the project',
    },
    {
      name: 'architecture',
      description: 'Key architectural patterns and structure',
    },
    {
      name: 'entry_points',
      description: 'Main files, entry points, and key modules',
    },
    {
      name: 'dependencies',
      description: 'Important dependencies and external integrations',
    },
    {
      name: 'patterns',
      description: 'Code patterns, conventions, and practices',
    },
    {
      name: 'concerns',
      description:
        'Potential issues, technical debt, or areas needing attention',
    },
  ],

  explorationHints: [
    'Start broad: list the root directory to see the overall structure',
    'Check package.json, setup files, or documentation for tech stack info',
    'Identify entry points (main files, index files, route definitions)',
    'Understand how code is organized (by feature, layer, etc.)',
    'Focus on core functionality and main workflows',
    'Note important libraries and their usage patterns',
  ],

  summaryInstructions: `Include:
1. **Overview**: What is this project and what does it do?
2. **Key Findings**: Most important discoveries about the codebase
3. **Architecture**: High-level architecture and design patterns
4. **Technologies**: Main technologies, frameworks, and dependencies
5. **Code Quality**: Observations about code organization and quality
6. **Recommendations**: Any suggestions for improvement or areas needing attention

Keep it concise but informative. This summary should help someone understand the project quickly.`,
};

registerProfile(CODEBASE_ANALYSIS_PROFILE);

/**
 * Interpolate template variables in the initial message
 */
export function interpolateMessage(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
