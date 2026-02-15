#!/usr/bin/env tsx
import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Config {
  thresholds: {
    cyclomaticComplexity: { error: number; warn: number };
    functionLines: { error: number; warn: number };
    fileLines: { error: number; warn: number };
    nestingDepth: { error: number; warn: number };
    functionParameters: { error: number; warn: number };
  };
  exclude: string[];
  include: string[];
}

interface FileMetrics {
  filePath: string;
  totalLines: number;
  sourceLines: number;
  commentLines: number;
  blankLines: number;
  functions: FunctionMetric[];
  classes: ClassMetric[];
  totalComplexity: number;
  maxComplexity: number;
  maxNestingDepth: number;
  maxParameters: number;
}

interface FunctionMetric {
  name: string;
  line: number;
  complexity: number;
  lines: number;
  parameters: number;
  nestingDepth: number;
}

interface ClassMetric {
  name: string;
  line: number;
  methodCount: number;
}

interface AnalysisResult {
  passed: FileMetrics[];
  warnings: FileMetrics[];
  errors: FileMetrics[];
  totalFiles: number;
}

function loadConfig(): Config {
  const configPath = path.join(__dirname, '..', 'code-quality.config.json');
  
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Config;
  }
  
  // Default config
  return {
    thresholds: {
      cyclomaticComplexity: { error: 15, warn: 10 },
      functionLines: { error: 100, warn: 75 },
      fileLines: { error: 300, warn: 250 },
      nestingDepth: { error: 4, warn: 3 },
      functionParameters: { error: 5, warn: 4 },
    },
    exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**', '**/*.config.ts'],
    include: ['src/**/*.ts'],
  };
}

function calculateComplexity(node: Node): number {
  let complexity = 0;
  
  // Count decision points
  node.forEachDescendant((child) => {
    const kind = child.getKind();
    
    switch (kind) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CaseClause:
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression:
        complexity++;
        break;
      
      case SyntaxKind.BinaryExpression:
        const binaryExpr = child.asKind(SyntaxKind.BinaryExpression);
        if (binaryExpr) {
          const operator = binaryExpr.getOperatorToken().getKind();
          if (operator === SyntaxKind.AmpersandAmpersandToken || 
              operator === SyntaxKind.BarBarToken ||
              operator === SyntaxKind.QuestionQuestionToken) {
            complexity++;
          }
        }
        break;
    }
  });
  
  return complexity + 1; // Base complexity is 1
}

function calculateNestingDepth(node: Node, currentDepth = 0): number {
  let maxDepth = currentDepth;
  
  node.forEachChild((child) => {
    const kind = child.getKind();
    let newDepth = currentDepth;
    
    // Increment depth for block-creating structures
    if (
      kind === SyntaxKind.IfStatement ||
      kind === SyntaxKind.ForStatement ||
      kind === SyntaxKind.ForInStatement ||
      kind === SyntaxKind.ForOfStatement ||
      kind === SyntaxKind.WhileStatement ||
      kind === SyntaxKind.DoStatement ||
      kind === SyntaxKind.SwitchStatement ||
      kind === SyntaxKind.TryStatement ||
      kind === SyntaxKind.CatchClause ||
      kind === SyntaxKind.Block
    ) {
      newDepth++;
    }
    
    const childMaxDepth = calculateNestingDepth(child, newDepth);
    maxDepth = Math.max(maxDepth, childMaxDepth);
  });
  
  return maxDepth;
}

function countLines(sourceFile: SourceFile): {
  total: number;
  source: number;
  comment: number;
  blank: number;
} {
  const text = sourceFile.getFullText();
  const lines = text.split('\n');
  
  let sourceLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  
  let inMultilineComment = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') {
      blankLines++;
      continue;
    }
    
    // Check for multiline comment start/end
    if (trimmed.startsWith('/*')) {
      inMultilineComment = true;
      commentLines++;
      if (trimmed.includes('*/')) {
        inMultilineComment = false;
      }
      continue;
    }
    
    if (inMultilineComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inMultilineComment = false;
      }
      continue;
    }
    
    // Single line comment
    if (trimmed.startsWith('//')) {
      commentLines++;
      continue;
    }
    
    sourceLines++;
  }
  
  return {
    total: lines.length,
    source: sourceLines,
    comment: commentLines,
    blank: blankLines,
  };
}

function analyzeFunctions(sourceFile: SourceFile): FunctionMetric[] {
  const functions: FunctionMetric[] = [];
  
  // Find all function declarations, arrow functions, and method declarations
  sourceFile.forEachDescendant((node) => {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node)
    ) {
      const name = 
        Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)
          ? node.getName() || '<anonymous>'
          : '<arrow>';
      
      const parameters = node.getParameters().length;
      const complexity = calculateComplexity(node);
      const nestingDepth = calculateNestingDepth(node);
      
      // Calculate function lines
      const start = node.getStartLineNumber();
      const end = node.getEndLineNumber();
      const lines = end - start + 1;
      
      functions.push({
        name,
        line: start,
        complexity,
        lines,
        parameters,
        nestingDepth,
      });
    }
  });
  
  return functions;
}

function analyzeClasses(sourceFile: SourceFile): ClassMetric[] {
  const classes: ClassMetric[] = [];
  
  sourceFile.forEachDescendant((node) => {
    if (Node.isClassDeclaration(node)) {
      const name = node.getName() || '<anonymous>';
      const methods = node.getMethods();
      
      classes.push({
        name,
        line: node.getStartLineNumber(),
        methodCount: methods.length,
      });
    }
  });
  
  return classes;
}

function analyzeFile(sourceFile: SourceFile): FileMetrics {
  const lineCounts = countLines(sourceFile);
  const functions = analyzeFunctions(sourceFile);
  const classes = analyzeClasses(sourceFile);
  
  const totalComplexity = functions.reduce((sum, f) => sum + f.complexity, 0);
  const maxComplexity = functions.length > 0 
    ? Math.max(...functions.map(f => f.complexity))
    : 0;
  const maxNestingDepth = functions.length > 0
    ? Math.max(...functions.map(f => f.nestingDepth))
    : 0;
  const maxParameters = functions.length > 0
    ? Math.max(...functions.map(f => f.parameters))
    : 0;
  
  return {
    filePath: sourceFile.getFilePath(),
    totalLines: lineCounts.total,
    sourceLines: lineCounts.source,
    commentLines: lineCounts.comment,
    blankLines: lineCounts.blank,
    functions,
    classes,
    totalComplexity,
    maxComplexity,
    maxNestingDepth,
    maxParameters,
  };
}

function categorizeResults(metrics: FileMetrics[], config: Config): AnalysisResult {
  const passed: FileMetrics[] = [];
  const warnings: FileMetrics[] = [];
  const errors: FileMetrics[] = [];
  
  for (const metric of metrics) {
    const hasError = 
      metric.maxComplexity > config.thresholds.cyclomaticComplexity.error ||
      metric.totalLines > config.thresholds.fileLines.error ||
      metric.maxNestingDepth > config.thresholds.nestingDepth.error ||
      metric.maxParameters > config.thresholds.functionParameters.error ||
      metric.functions.some(f => f.lines > config.thresholds.functionLines.error);
    
    const hasWarning = 
      metric.maxComplexity > config.thresholds.cyclomaticComplexity.warn ||
      metric.totalLines > config.thresholds.fileLines.warn ||
      metric.maxNestingDepth > config.thresholds.nestingDepth.warn ||
      metric.maxParameters > config.thresholds.functionParameters.warn ||
      metric.functions.some(f => f.lines > config.thresholds.functionLines.warn);
    
    if (hasError) {
      errors.push(metric);
    } else if (hasWarning) {
      warnings.push(metric);
    } else {
      passed.push(metric);
    }
  }
  
  return {
    passed,
    warnings,
    errors,
    totalFiles: metrics.length,
  };
}

function printFileReport(metric: FileMetrics, config: Config): void {
  const relativePath = path.relative(process.cwd(), metric.filePath);
  
  console.log(chalk.bold(`\nFile: ${relativePath}`));
  
  // Cyclomatic Complexity
  const complexityStatus = 
    metric.maxComplexity > config.thresholds.cyclomaticComplexity.error ? '❌' :
    metric.maxComplexity > config.thresholds.cyclomaticComplexity.warn ? '⚠️' : '✓';
  const complexityColor = 
    metric.maxComplexity > config.thresholds.cyclomaticComplexity.error ? chalk.red :
    metric.maxComplexity > config.thresholds.cyclomaticComplexity.warn ? chalk.yellow : chalk.green;
  
  console.log(`├─ ${complexityColor(`Cyclomatic Complexity: ${metric.maxComplexity} ${complexityStatus} (warn: ${config.thresholds.cyclomaticComplexity.warn}, error: ${config.thresholds.cyclomaticComplexity.error})`)}`);
  
  // Lines of code
  const linesStatus = 
    metric.totalLines > config.thresholds.fileLines.error ? '❌' :
    metric.totalLines > config.thresholds.fileLines.warn ? '⚠️' : '✓';
  const linesColor = 
    metric.totalLines > config.thresholds.fileLines.error ? chalk.red :
    metric.totalLines > config.thresholds.fileLines.warn ? chalk.yellow : chalk.green;
  
  console.log(`├─ ${linesColor(`Lines of Code: ${metric.totalLines} ${linesStatus} (${metric.sourceLines} source, ${metric.commentLines} comments, ${metric.blankLines} blank)`)}`);
  
  // Functions
  console.log(`├─ Functions: ${metric.functions.length}`);
  
  if (metric.functions.length > 0) {
    const avgComplexity = metric.totalComplexity / metric.functions.length;
    console.log(`├─ Avg Complexity/Function: ${avgComplexity.toFixed(2)}`);
  }
  
  // Nesting depth
  const nestingStatus = 
    metric.maxNestingDepth > config.thresholds.nestingDepth.error ? '❌' :
    metric.maxNestingDepth > config.thresholds.nestingDepth.warn ? '⚠️' : '✓';
  const nestingColor = 
    metric.maxNestingDepth > config.thresholds.nestingDepth.error ? chalk.red :
    metric.maxNestingDepth > config.thresholds.nestingDepth.warn ? chalk.yellow : chalk.green;
  
  console.log(`├─ ${nestingColor(`Max Nesting Depth: ${metric.maxNestingDepth} ${nestingStatus} (warn: ${config.thresholds.nestingDepth.warn}, error: ${config.thresholds.nestingDepth.error})`)}`);
  
  // Parameters
  const paramsStatus = 
    metric.maxParameters > config.thresholds.functionParameters.error ? '❌' :
    metric.maxParameters > config.thresholds.functionParameters.warn ? '⚠️' : '✓';
  const paramsColor = 
    metric.maxParameters > config.thresholds.functionParameters.error ? chalk.red :
    metric.maxParameters > config.thresholds.functionParameters.warn ? chalk.yellow : chalk.green;
  
  console.log(`└─ ${paramsColor(`Max Parameters: ${metric.maxParameters} ${paramsStatus} (warn: ${config.thresholds.functionParameters.warn}, error: ${config.thresholds.functionParameters.error})`)}`);
  
  // Show problematic functions
  const problematicFunctions = metric.functions.filter(
    f => 
      f.complexity > config.thresholds.cyclomaticComplexity.warn ||
      f.lines > config.thresholds.functionLines.warn ||
      f.nestingDepth > config.thresholds.nestingDepth.warn ||
      f.parameters > config.thresholds.functionParameters.warn
  );
  
  if (problematicFunctions.length > 0) {
    console.log(chalk.yellow(`\n   Problematic functions:`));
    for (const func of problematicFunctions) {
      const issues: string[] = [];
      if (func.complexity > config.thresholds.cyclomaticComplexity.warn) {
        issues.push(`complexity: ${func.complexity}`);
      }
      if (func.lines > config.thresholds.functionLines.warn) {
        issues.push(`lines: ${func.lines}`);
      }
      if (func.nestingDepth > config.thresholds.nestingDepth.warn) {
        issues.push(`nesting: ${func.nestingDepth}`);
      }
      if (func.parameters > config.thresholds.functionParameters.warn) {
        issues.push(`params: ${func.parameters}`);
      }
      console.log(chalk.yellow(`   - ${func.name} (line ${func.line}): ${issues.join(', ')}`));
    }
  }
}

function printSummary(result: AnalysisResult): void {
  console.log(chalk.bold('\n' + '='.repeat(50)));
  console.log(chalk.bold('Summary'));
  console.log('='.repeat(50));
  
  console.log(chalk.green(`✓ ${result.passed.length} file(s) passed`));
  
  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`⚠️  ${result.warnings.length} file(s) with warnings`));
  }
  
  if (result.errors.length > 0) {
    console.log(chalk.red(`❌ ${result.errors.length} file(s) exceeded thresholds`));
  }
  
  console.log(`\nTotal files analyzed: ${result.totalFiles}`);
}

function shouldExcludeFile(filePath: string, config: Config): boolean {
  return config.exclude.some(pattern => {
    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    return regex.test(filePath);
  });
}

async function getStagedFiles(config: Config): Promise<string[]> {
  const { execSync } = await import('child_process');
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', { 
      encoding: 'utf-8' 
    });
    return output
      .split('\n')
      .filter(file => file.endsWith('.ts'))
      .map(file => path.resolve(process.cwd(), file))
      .filter(file => !shouldExcludeFile(file, config));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  
  console.log(chalk.bold.cyan('\n🔍 Code Quality Analysis'));
  console.log(chalk.cyan('=' .repeat(50)));
  
  // Determine which files to analyze
  let filesToAnalyze: string[] = [];
  
  if (args.includes('--staged')) {
    filesToAnalyze = await getStagedFiles(config);
    if (filesToAnalyze.length === 0) {
      console.log(chalk.yellow('\nNo staged TypeScript files to analyze.'));
      process.exit(0);
    }
    console.log(chalk.cyan(`\nAnalyzing ${filesToAnalyze.length} staged file(s)...\n`));
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // Specific files provided as arguments
    filesToAnalyze = args.map(file => path.resolve(process.cwd(), file));
  } else {
    // Analyze all files in src/
    const project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    });
    
    const sourceFiles = project.getSourceFiles();
    filesToAnalyze = sourceFiles
      .filter(sf => {
        const filePath = sf.getFilePath();
        // Check if file matches include patterns
        const included = config.include.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
          return regex.test(filePath);
        });
        
        // Check if file matches exclude patterns
        const excluded = config.exclude.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
          return regex.test(filePath);
        });
        
        return included && !excluded;
      })
      .map(sf => sf.getFilePath());
  }
  
  if (filesToAnalyze.length === 0) {
    console.log(chalk.yellow('\nNo files to analyze.'));
    process.exit(0);
  }
  
  // Create project and analyze files
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
  });
  
  const metrics: FileMetrics[] = [];
  
  for (const filePath of filesToAnalyze) {
    const sourceFile = project.addSourceFileAtPath(filePath);
    const fileMetrics = analyzeFile(sourceFile);
    metrics.push(fileMetrics);
  }
  
  // Categorize results
  const result = categorizeResults(metrics, config);
  
  // Print detailed reports for warnings and errors
  if (result.warnings.length > 0) {
    console.log(chalk.yellow.bold('\n⚠️  Files with warnings:'));
    for (const metric of result.warnings) {
      printFileReport(metric, config);
    }
  }
  
  if (result.errors.length > 0) {
    console.log(chalk.red.bold('\n❌ Files with errors:'));
    for (const metric of result.errors) {
      printFileReport(metric, config);
    }
  }
  
  // Print summary
  printSummary(result);
  
  // Exit with error code if there are errors
  if (result.errors.length > 0) {
    console.log(chalk.red('\n❌ Code quality check failed!\n'));
    process.exit(1);
  } else if (result.warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  Code quality check passed with warnings.\n'));
    process.exit(0);
  } else {
    console.log(chalk.green('\n✓ All checks passed!\n'));
    process.exit(0);
  }
}

main().catch((error: Error) => {
  console.error(chalk.red('Error running code quality check:'), error);
  process.exit(1);
});
