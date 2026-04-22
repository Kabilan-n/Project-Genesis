# Multi-Provider LLM Integration

This directory contains a flexible LLM provider system that supports multiple AI model services. You can switch between providers without changing any code—just update your `.env` file.

## Supported Providers

### 1. **Anthropic (Claude)** — Default
Best for: High-quality reasoning, recommended for production.

```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

**Common models:**
- `claude-opus-4-6` — Most capable, slowest
- `claude-sonnet-4-6` — Balanced quality/speed
- `claude-haiku-4-5-20251001` — Fastest, lowest cost

[Get API key](https://console.anthropic.com)

---

### 2. **OpenAI (GPT)**
Best for: Compatibility with existing OpenAI infrastructure.

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

**Common models:**
- `gpt-4o` — Flagship model
- `gpt-4-turbo` — Fast variant
- `gpt-3.5-turbo` — Cost-effective

[Get API key](https://platform.openai.com/account/api-keys)

---

### 3. **Ollama (Local Open-Source Models)**
Best for: Privacy, offline operation, cost-free inference.

Requires: Install [Ollama](https://ollama.ai), then run: `ollama pull <model>`

```env
LLM_PROVIDER=ollama
LLM_MODEL=llama2
OLLAMA_BASE_URL=http://localhost:11434
```

**Common models:**
- `llama2` — Meta's Llama 2
- `mistral` — Mistral 7B
- `neural-chat` — Intel's optimized chat model
- `phi` — Microsoft's lightweight model

```bash
# Example: Run Ollama with llama2
ollama pull llama2
ollama serve
```

---

### 4. **HuggingFace**
Best for: Access to thousands of open-source models.

```env
LLM_PROVIDER=huggingface
LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
HUGGINGFACE_API_KEY=hf_...
```

**Common models:**
- `meta-llama/Llama-2-7b-chat-hf` — Llama 2 chat
- `mistralai/Mistral-7B-Instruct-v0.1` — Mistral chat
- `tiiuae/falcon-7b` — Falcon 7B

[Get API key](https://huggingface.co/settings/tokens)

---

## Quick Start

### Using Claude (Recommended)
1. Get an API key from [Anthropic Console](https://console.anthropic.com)
2. Update `.env`:
   ```env
   LLM_PROVIDER=anthropic
   LLM_MODEL=claude-haiku-4-5-20251001
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Run the simulation:
   ```bash
   npm run start
   ```

### Using Ollama (Local, Free)
1. Install [Ollama](https://ollama.ai)
2. Pull a model:
   ```bash
   ollama pull llama2
   ```
3. Start Ollama:
   ```bash
   ollama serve
   ```
4. Update `.env`:
   ```env
   LLM_PROVIDER=ollama
   LLM_MODEL=llama2
   OLLAMA_BASE_URL=http://localhost:11434
   ```
5. Run the simulation:
   ```bash
   npm run start
   ```

### Using OpenAI
1. Get an API key from [OpenAI Platform](https://platform.openai.com/account/api-keys)
2. Update `.env`:
   ```env
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-4o
   OPENAI_API_KEY=sk-...
   ```
3. Run the simulation:
   ```bash
   npm run start
   ```

---

## Architecture

All providers implement the `LLMClient` interface (see [types.ts](./types.ts)), which defines:

```typescript
interface LLMClient {
  getAgentDecision(prompt: string): Promise<AgentDecision>;
  getConversationResponse(prompt: string): Promise<ConversationTurnResponse>;
  getTradeResponse(prompt: string): Promise<TradeResponse>;
  getRawCompletion(prompt: string, maxTokens?: number): Promise<string>;
}
```

The `LLMFactory` creates the appropriate client at runtime based on environment variables:

```typescript
import { LLMFactory } from './llm/LLMFactory.js';

const llm = LLMFactory.fromEnv(); // Automatically selects based on LLM_PROVIDER
```

**Provider Files:**
- [LLMFactory.ts](./LLMFactory.ts) — Factory & configuration
- [types.ts](./types.ts) — Interface definitions
- [providers/AnthropicClient.ts](./providers/AnthropicClient.ts) — Claude integration
- [providers/OpenAIClient.ts](./providers/OpenAIClient.ts) — GPT integration
- [providers/OllamaClient.ts](./providers/OllamaClient.ts) — Local models
- [providers/HuggingFaceClient.ts](./providers/HuggingFaceClient.ts) — HuggingFace models

---

## Adding a New Provider

To add a new LLM provider:

1. Create `providers/YourProviderClient.ts` implementing `LLMClient`:
   ```typescript
   import type { LLMClient } from '../types.js';

   export class YourProviderClient implements LLMClient {
     async getAgentDecision(prompt: string): Promise<AgentDecision> { /* ... */ }
     async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> { /* ... */ }
     async getTradeResponse(prompt: string): Promise<TradeResponse> { /* ... */ }
     async getRawCompletion(prompt: string, maxTokens?: number): Promise<string> { /* ... */ }
   }
   ```

2. Update `LLMFactory.ts`:
   ```typescript
   case 'your-provider':
     return new YourProviderClient(config.model, config.apiKey);
   ```

3. Update `.env.example` with new provider config.

4. Update this README with usage instructions.

---

## Troubleshooting

### "Missing API key for provider"
Ensure your API key is set in `.env` for your chosen provider.

### "Connection refused" (Ollama)
Make sure Ollama is running: `ollama serve`

### "Model not found" (Ollama)
Pull the model first: `ollama pull llama2`

### Slow responses
- Switch to a lighter model (e.g., `phi` on Ollama, `gpt-3.5-turbo` on OpenAI)
- Check your internet connection for cloud providers
- Increase `max_tokens` in `.env` if needed

---

## Cost Comparison

| Provider    | Model         | Cost (per 1M tokens) | Quality | Speed   |
|-------------|---------------|----------------------|---------|---------|
| Anthropic   | Haiku         | $0.80                | High    | Fast    |
| Anthropic   | Sonnet        | $3.00                | Very High | Medium |
| OpenAI      | gpt-3.5-turbo | $1.50                | Good    | Fast    |
| OpenAI      | gpt-4o        | $15.00               | Excellent | Medium |
| Ollama      | (any)         | Free                 | Variable | Slow    |
| HuggingFace | (various)     | Free (inference)     | Variable | Slow    |

*Prices approximate as of 2026. Check provider websites for current rates.*

---

## Environment Variables Reference

```bash
# Provider selection
LLM_PROVIDER=anthropic              # anthropic, openai, ollama, huggingface
LLM_MODEL=claude-haiku-4-5-20251001 # Model identifier for chosen provider

# API Keys (only needed for non-Ollama providers)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
HUGGINGFACE_API_KEY=hf_...

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
```

---

## Performance Tips

1. **Use Ollama for development**: Fast iteration without API costs.
2. **Use Claude Haiku for production**: Best cost-to-quality ratio.
3. **Batch requests**: Simulation can be optimized to batch LLM calls.
4. **Cache results**: Consider caching similar prompts (not implemented yet).
5. **Monitor token usage**: Track API costs for cloud providers.
