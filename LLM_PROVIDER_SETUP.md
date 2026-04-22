# Multi-Provider LLM Setup Guide

Your Agent World simulation now supports **multiple LLM providers**! Switch between Claude (Anthropic), GPT (OpenAI), Ollama (local), or HuggingFace models without changing any code.

## 📋 Quick Summary

### What Changed
✅ **New files created:**
- `packages/simulation/src/llm/LLMFactory.ts` — Factory for creating providers
- `packages/simulation/src/llm/types.ts` — Common interface for all providers
- `packages/simulation/src/llm/providers/AnthropicClient.ts` — Claude integration
- `packages/simulation/src/llm/providers/OpenAIClient.ts` — GPT integration
- `packages/simulation/src/llm/providers/OllamaClient.ts` — Local models
- `packages/simulation/src/llm/providers/HuggingFaceClient.ts` — HuggingFace models
- `packages/simulation/src/llm/README.md` — Detailed provider documentation

✅ **Updated files:**
- `.env` — Added `LLM_PROVIDER` and provider-specific API keys
- `.env.example` — Updated with new configuration options
- `packages/simulation/src/agent/AgentEngine.ts` — Uses factory instead of hardcoded Claude
- `packages/simulation/src/social/ConversationEngine.ts` — Uses factory
- `packages/simulation/src/social/TradeEngine.ts` — Uses factory
- `packages/simulation/src/social/MemoryDecay.ts` — Uses factory
- `packages/simulation/src/__tests__/ClaudeClient.test.ts` — Updated for AnthropicClient

### What Stayed the Same
✅ All agent behavior and simulation logic is **identical**
✅ The parsers and response formats are **unchanged**
✅ Your existing `.env` configuration still works (defaults to Anthropic/Claude)

---

## 🚀 Getting Started

### Option 1: Keep Using Claude (Current Setup)
Your `.env` is already configured. Just run:
```bash
npm run start
```

### Option 2: Switch to Ollama (Local, Free)
Perfect for development with **zero API costs**.

1. **Install Ollama:** https://ollama.ai
2. **Pull a model:**
   ```bash
   ollama pull llama2
   # or: ollama pull mistral
   ```
3. **Start Ollama:**
   ```bash
   ollama serve
   ```
4. **Update `.env`:**
   ```env
   LLM_PROVIDER=ollama
   LLM_MODEL=llama2
   OLLAMA_BASE_URL=http://localhost:11434
   ```
5. **Run simulation:**
   ```bash
   npm run start
   ```

### Option 3: Switch to OpenAI (GPT)
1. **Get API key:** https://platform.openai.com/account/api-keys
2. **Install SDK:**
   ```bash
   npm install openai
   ```
3. **Update `.env`:**
   ```env
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-4o
   OPENAI_API_KEY=sk-...
   ```
4. **Run simulation:**
   ```bash
   npm run start
   ```

### Option 4: Switch to HuggingFace
1. **Get API key:** https://huggingface.co/settings/tokens
2. **Update `.env`:**
   ```env
   LLM_PROVIDER=huggingface
   LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
   HUGGINGFACE_API_KEY=hf_...
   ```
3. **Run simulation:**
   ```bash
   npm run start
   ```

---

## 📚 Architecture

### How It Works

All providers implement a **common interface** (`LLMClient`):

```typescript
interface LLMClient {
  getAgentDecision(prompt: string): Promise<AgentDecision>;
  getConversationResponse(prompt: string): Promise<ConversationTurnResponse>;
  getTradeResponse(prompt: string): Promise<TradeResponse>;
  getRawCompletion(prompt: string, maxTokens?: number): Promise<string>;
}
```

The **`LLMFactory`** creates the right client based on environment variables:

```typescript
// This is all the code needed in your app:
import { LLMFactory } from './llm/LLMFactory.js';

const llm = LLMFactory.fromEnv(); // Automatically selects based on LLM_PROVIDER
const decision = await llm.getAgentDecision(prompt);
```

### Provider Files

```
packages/simulation/src/llm/
├── LLMFactory.ts                 # Factory pattern & config loading
├── types.ts                       # Common interface definition
├── README.md                      # Detailed docs
├── providers/
│   ├── AnthropicClient.ts        # Claude API integration
│   ├── OpenAIClient.ts           # OpenAI API integration (optional dep)
│   ├── OllamaClient.ts           # Local models via REST API
│   └── HuggingFaceClient.ts      # HuggingFace inference API
└── [Old] ClaudeClient.ts         # Deprecated (for reference only)
```

---

## 🔧 Environment Variables

### Supported Values

```bash
# Provider selection (required)
LLM_PROVIDER=anthropic|openai|ollama|huggingface

# Model identifier (required)
LLM_MODEL=claude-haiku-4-5-20251001    # See provider docs for options

# API Keys (required except for ollama)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
HUGGINGFACE_API_KEY=hf_...

# Ollama configuration (local only)
OLLAMA_BASE_URL=http://localhost:11434
```

### Example Configurations

**Claude (Anthropic):**
```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

**GPT (OpenAI):**
```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

**Ollama (Local):**
```env
LLM_PROVIDER=ollama
LLM_MODEL=llama2
OLLAMA_BASE_URL=http://localhost:11434
```

**HuggingFace:**
```env
LLM_PROVIDER=huggingface
LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
HUGGINGFACE_API_KEY=hf_...
```

---

## 💡 Model Recommendations

### Best Overall (Recommended for Production)
- **Claude Haiku** (`claude-haiku-4-5-20251001`) via Anthropic
  - Cost: $0.80 per 1M tokens
  - Quality: High
  - Speed: Fast

### Best for Budget
- **Ollama with Llama2** (local, free)
  - Cost: Free (download ~4GB)
  - Quality: Good
  - Speed: Slow (depends on hardware)

### Best for Quality
- **Claude Opus** (`claude-opus-4-6`) or **GPT-4o** via OpenAI
  - Cost: Higher
  - Quality: Excellent
  - Speed: Medium

### Best for Development
- **Ollama with Mistral** (local, fast)
  - Cost: Free
  - Quality: Good
  - Speed: Medium

---

## ⚠️ Troubleshooting

### "Missing API key for provider"
Make sure your API key is set in `.env` for your chosen provider.

### "Connection refused" (Ollama)
Ollama must be running:
```bash
ollama serve
```

### "Model not found" (Ollama)
Pull the model first:
```bash
ollama pull llama2
```

### Slow inference
- Try a smaller model: `phi` (Ollama), `gpt-3.5-turbo` (OpenAI)
- Use local Ollama instead of cloud APIs
- Check your internet connection

### "OpenAI SDK not installed"
If using OpenAI provider, install it:
```bash
npm install openai
```

---

## 🎯 Next Steps

1. **Try different providers** to find what works best for your use case
2. **Monitor costs** if using cloud APIs (Anthropic, OpenAI, HuggingFace)
3. **Customize prompts** in `PromptBuilder.ts` for better results
4. **Add new providers** by implementing the `LLMClient` interface

For detailed documentation, see: [`packages/simulation/src/llm/README.md`](packages/simulation/src/llm/README.md)
