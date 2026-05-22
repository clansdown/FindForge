**# Adding Tool Calling Support for Scientific Calculator, Wikipedia Search, and Catholic Encyclopedia Search**

This document outlines everything involved in integrating tool calling (function calling) into your LLM research tool that streams answers via **OpenRouter.ai**. It is designed as a blueprint for **openCode** to generate a detailed implementation plan. The tools are assumed to be "passed in" as executable functions or modules in your backend.

## 1. Overview of Tool Calling with OpenRouter.ai

OpenRouter standardizes tool calling across models (OpenAI-compatible format). Models supporting tools can be filtered at [openrouter.ai/models?supported_parameters=tools](https://openrouter.ai/models?supported_parameters=tools).

**Core Flow**:
1. Define tools using JSON Schema (OpenAI format).
2. Include `tools` array and `tool_choice` (`auto`, `none`, or specific tool) in the API request.
3. LLM responds with `tool_calls` (or streams deltas containing them).
4. Your system executes the tool(s).
5. Append tool result(s) as `role: "tool"` message(s) with `tool_call_id`.
6. Continue the conversation (possibly multi-turn for complex reasoning).
7. Stream the final assistant response to the user.

**Streaming Considerations**:
- Use `stream: true`.
- Parse streaming deltas for partial content and tool calls.
- Handle `finish_reason: "tool_calls"`.
- For multi-step agents, loop until `finish_reason: "stop"`.
- Maintain conversation history with tool messages for context.

**Key API Elements** (from OpenRouter docs):
```json
{
  "model": "anthropic/claude-3.5-sonnet" | "openai/gpt-4o" | etc.,
  "messages": [ ... ],
  "tools": [ { "type": "function", "function": { "name": "...", "description": "...", "parameters": { ... } } } ],
  "tool_choice": "auto",
  "stream": true
}
```

Tool result message:
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "Tool execution result as string"
}
```

## 2. Tool Definitions (JSON Schema)

### Scientific Calculator Tool
**Purpose**: Accurate math computations (avoid LLM hallucination on calculations).

```json
{
  "type": "function",
  "function": {
    "name": "scientific_calculator",
    "description": "Evaluate mathematical expressions safely. Supports basic arithmetic, trig functions, logarithms, exponents, etc. Use for any numerical computation.",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "Math expression (e.g., 'sin(π/2) + log(10)', '2**10', '(3 + 4) * 5'). Use Python math syntax."
        }
      },
      "required": ["expression"]
    }
  }
}
```

**Implementation** (Python example using `code_execution` or `sympy`/`math`):
- Sanitize input (no `exec` on raw user code).
- Support common constants (`pi`, `e`) and functions (`sin`, `cos`, `log`, `sqrt`, etc.).
- Return formatted result + explanation if needed.

### Wikipedia Search Tool
**Purpose**: Real-time factual retrieval and summaries.

```json
{
  "type": "function",
  "function": {
    "name": "wikipedia_search",
    "description": "Search Wikipedia for information on a topic. Returns summaries, key facts, and links. Ideal for general knowledge, history, science, etc.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query or topic name"
        },
        "limit": {
          "type": "integer",
          "description": "Number of results (default 3)",
          "default": 3
        }
      },
      "required": ["query"]
    }
  }
}
```

**Implementation**:
- Use MediaWiki API: `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=...`
- Or `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` for extracts.
- Return structured text (titles, snippets, URLs).

### Catholic Encyclopedia Search Tool
**Purpose**: Specialized search in Catholic theological/historical resources (primarily New Advent).

```json
{
  "type": "function",
  "function": {
    "name": "catholic_encyclopedia_search",
    "description": "Search the Catholic Encyclopedia (New Advent) for authoritative information on Catholic doctrine, history, saints, liturgy, etc.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search term or topic (e.g., 'Transubstantiation', 'Council of Trent')"
        },
        "limit": {
          "type": "integer",
          "default": 3
        }
      },
      "required": ["query"]
    }
  }
}
```

**Implementation**:
- Base: https://www.newadvent.org/cathen/
- Use site search or scrape/index key articles (respect robots.txt; prefer public API if available).
- Fallback to Google `site:newadvent.org/cathen query`.
- Return article excerpts, titles, and direct links.

## 3. Tool Registry & Execution Layer

- Create a registry mapping tool names to executable functions.
- Each tool function should:
  - Accept parsed arguments.
  - Execute securely (rate limits, timeouts, sanitization).
  - Return a string (or structured object serialized to string).
  - Handle errors gracefully (return error message for LLM).
- Support parallel tool calls if model allows.

**Example Registry (TypeScript/Python pseudocode)**:
```python
tools = {
    "scientific_calculator": scientific_calculator_func,
    "wikipedia_search": wikipedia_search_func,
    "catholic_encyclopedia_search": catholic_encyclopedia_search_func
}

async def execute_tool(name, args):
    if name in tools:
        return await tools[name](**args)
    raise ValueError("Unknown tool")
```

## 4. Integration into Streaming Pipeline

1. **Initial Request**: Send user message + tools array.
2. **Stream Parsing**:
   - Accumulate content.
   - Detect tool call deltas/blocks.
3. **Tool Execution Loop**:
   - When `tool_calls` received, execute (in parallel if multiple).
   - Append tool results to messages.
   - Re-call LLM (or continue stream if supported).
4. **Final Streaming**: Stream assistant's synthesized response to user.
5. **State Management**: Persist full message history (including tool calls/results) per conversation/session.
6. **Error Handling**: Tool failures → inform LLM; retry logic; user-visible messages.
7. **Safety**:
   - Validate tool arguments.
   - Rate limiting per tool.
   - Content filtering on results if needed.

## 5. Prompt Engineering & System Instructions

Include in system prompt:
> "You have access to the following tools: [brief descriptions]. Use them when necessary for accuracy. For math, always use the calculator. For facts, prefer search tools over internal knowledge."

Provide few-shot examples of tool use in conversation history.

## 6. Testing & Edge Cases

- **Math**: Complex expressions, units, multi-step.
- **Search**: Ambiguous queries, disambiguation, long articles.
- **Streaming**: Partial tool calls, interrupted streams.
- **Multi-turn**: Agentic loops (research → calculate → summarize).
- **Model Variability**: Test across Claude, GPT, etc.
- **Cost/Latency**: Monitor token usage (tools add to prompt).

## 7. Implementation Roadmap for openCode

1. **Define Tool Schemas** (static JSON).
2. **Implement Tool Executors** (with security).
3. **API Client Wrapper** for OpenRouter (handle streaming + tool parsing).
4. **Conversation Manager** (history + tool loop).
5. **Streaming Response Handler** (parse + forward to frontend).
6. **UI Updates** (show "Thinking...", "Using tool: X", intermediate results).
7. **Logging & Monitoring** (tool calls, latency, errors).
8. **Documentation & Examples** for new tools.

## 8. Additional Resources

- OpenRouter Tool Calling Guide
- OpenAI Function Calling Best Practices (compatible)
- Example repos: OpenRouter tool-calling demo on GitHub

This covers the complete surface area. Provide this Markdown to openCode along with your current codebase structure for a precise implementation plan.
