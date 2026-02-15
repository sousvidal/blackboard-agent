# Blackboard Agent

An AI-powered codebase analysis tool that uses Claude with a token-limited "blackboard" system for efficient exploration.

## Features

- 🤖 **AI-Powered Analysis**: Uses Claude to intelligently explore and understand codebases
- 📋 **Blackboard System**: Token-limited knowledge store that persists important findings without burning conversation tokens
- 🔧 **Smart Tools**: File reading, directory listing, and grep search capabilities
- 💾 **Complete Output**: Saves full conversation, metadata, and analysis to `.output/` folder
- 📊 **Token Tracking**: Real-time token usage and iteration display
- 🎨 **Beautiful Output**: Colorful, informative CLI interface with progress tracking
- ⚡ **Efficient**: Tool results aren't stored in conversation history - only curated insights on the blackboard

## Installation

```bash
npm install
npm run build
```

Or link globally:

```bash
npm link
```

## Configuration

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

Get your API key at [console.anthropic.com](https://console.anthropic.com/)

## Usage

### Analyze a Codebase

Analyze the current directory:

```bash
agent analyze
```

Analyze a specific path:

```bash
agent analyze --path ./src
```

Show most recent analysis without running the agent:

```bash
agent analyze --show
```

### How It Works

1. **Agent explores** the codebase using tools (list_dir, file_read, grep_search)
2. **Important findings** are saved to the blackboard via update_blackboard tool
3. **Tool results** are temporary - not stored in conversation history
4. **All artifacts saved** to `.output/` folder in the workspace
5. **Token limit** enforced at 4000 tokens to keep context manageable
6. **Fresh start** - Each analysis begins with an empty blackboard (no state loaded)

### Output Structure

Each analysis creates a timestamped folder in `.output/` containing:

```
.output/
└── analysis-2024-02-14-133045/
    ├── conversation.json       # Full conversation with all messages
    ├── blackboard.json         # Final blackboard state (JSON)
    ├── blackboard.md           # Blackboard as markdown
    ├── summary.md              # AI-generated analysis summary
    ├── metadata.json           # Token usage, iterations, timing
    └── tool-calls.json         # All tool executions with timing
```

**What's included:**

- **conversation.json**: Complete conversation history including tool calls and results
- **blackboard.json**: Structured blackboard data with all sections
- **blackboard.md**: Human-readable markdown version of blackboard
- **summary.md**: AI-generated summary of findings and recommendations
- **metadata.json**: Stats (iterations, tokens, duration, success/failure)
- **tool-calls.json**: Every tool call with inputs, outputs, and timing

### The Blackboard

The blackboard is organized into sections:

- **overview**: High-level project summary
- **architecture**: Key architectural patterns
- **entry_points**: Main files and entry points
- **dependencies**: Important dependencies
- **patterns**: Code patterns and conventions
- **concerns**: Potential issues or technical debt

Each section has a soft limit of ~600 tokens, with a total limit of 4000 tokens.

## Commands

### analyze

Analyze a codebase using the AI agent.

**Options:**
- `-p, --path <path>` - Target directory (default: current directory)
- `--show` - Show most recent analysis from .output folder

### help

Display help information.

### version

Display version information.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Run directly without building (pass arguments after --)
npm run dev:run -- analyze --path ./src
npm run dev:run -- --help

# Or use tsx directly
npx tsx src/index.ts analyze --path ./src

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

## Project Structure

```
src/
├── commands/
│   ├── analyze.ts          # Analyze command
│   ├── help.ts
│   └── version.ts
├── core/
│   ├── agent.ts           # Main agent loop
│   ├── blackboard.ts      # Blackboard management
│   ├── session.ts         # Session persistence
│   ├── tools.ts           # Tool definitions & execution
│   └── prompts.ts         # System prompts
├── utils/
│   ├── fs-utils.ts        # File system utilities
│   ├── logger.ts          # Logging
│   ├── token-counter.ts   # Token estimation
│   └── ui.ts              # CLI output formatting
└── index.ts               # Entry point
```

## Architecture

The agent uses a "blackboard pattern" to efficiently analyze codebases:

1. **Agentic Loop**: Claude makes decisions about what to explore next
2. **Tools**: Execute file operations and return results
3. **Blackboard**: Agent curates important findings into structured sections
4. **Session**: Everything is saved for future reference

### Why Blackboard?

Traditional agentic systems store all tool results in conversation history, which:
- Burns tokens rapidly
- Hits context limits quickly
- Stores lots of irrelevant information

The blackboard approach:
- ✅ Stores only curated insights
- ✅ Fixed token budget (4000 tokens)
- ✅ Agent decides what's important
- ✅ Persists between sessions

## Technologies

- **TypeScript** - Type-safe development
- **Claude (Anthropic)** - AI model for analysis
- **Commander** - CLI framework
- **Chalk** - Terminal styling
- **Pino** - Fast JSON logger
- **tsup** - TypeScript bundler

## License

MIT
