# LLM Provider Migration Guide

## What Happened?

Your Agent World simulation has been upgraded to support **multiple LLM providers**. Previously, it was hardcoded to use only Claude (Anthropic). Now you can use:

- ✅ **Anthropic (Claude)** — Default, high quality
- ✅ **OpenAI (GPT)** — Industry standard
- ✅ **Ollama (Local)** — Free, offline, privacy-first
- ✅ **HuggingFace** — Thousands of models to choose from

## For Existing Users

### ✅ Your Code Still Works!
- No breaking changes to agent behavior
- No changes to simulation logic
- Your existing `.env` configuration is still valid
- The API is identical from the agent's perspective

### What Changed

**Before:**
```typescript
import { ClaudeClient } from '../llm/ClaudeClient.js';
const claude = new ClaudeClient();
const decision = await claude.getAgentDecision(prompt);
```

**After:**
```typescript
import { LLMFactory } from '../llm/LLMFactory.js';
const llm = LLMFactory.fromEnv();
const decision = await llm.getAgentDecision(prompt);
```

The **behavior is identical**, but now it respects the `LLM_PROVIDER` environment variable.

## How to Switch Providers

### Quick Reference

**Current (Claude Haiku) - stays the same:**
```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

**Try Ollama (free, local):**
```env
LLM_PROVIDER=ollama
LLM_MODEL=llama2
OLLAMA_BASE_URL=http://localhost:11434
```

**Try OpenAI:**
```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

**Try HuggingFace:**
```env
LLM_PROVIDER=huggingface
LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
HUGGINGFACE_API_KEY=hf_...
```

Just update `.env` and restart the simulation!

## File Changes

### New Files (Safe to ignore)
```
packages/simulation/src/llm/
├── LLMFactory.ts                  # Factory for creating providers
├── types.ts                        # Common interface
├── README.md                       # Detailed provider documentation
└── providers/
    ├── AnthropicClient.ts         # Claude integration
    ├── OpenAIClient.ts            # GPT integration (optional)
    ├── OllamaClient.ts            # Local models
    ├── HuggingFaceClient.ts       # HuggingFace models
    └── ADDING_PROVIDERS.md        # How to add more providers
```

### Updated Files (Changes are backwards compatible)

**`.env`**
- Added `LLM_PROVIDER` field
- Added optional API keys for other providers
- Reorganized comments

**`.env.example`**
- Updated with provider options

**Core Simulation Files** (all use factory now)
- `src/agent/AgentEngine.ts`
- `src/social/ConversationEngine.ts`
- `src/social/TradeEngine.ts`
- `src/social/MemoryDecay.ts`
- `src/__tests__/ClaudeClient.test.ts`

### Deprecated (Still works, not removed)
- `src/llm/ClaudeClient.ts` — Replaced by `AnthropicClient.ts` but kept for reference

## Compatibility

| Feature | Status |
|---------|--------|
| Existing `.env` configs | ✅ Still works (defaults to Anthropic) |
| Agent behavior | ✅ Identical |
| Simulation logic | ✅ Unchanged |
| Test suite | ✅ Updated |
| API responses | ✅ Same format |
| JSON parsing | ✅ Same parsers |

## Migration Checklist

- [ ] Read this guide
- [ ] (Optional) Try a different provider by updating `.env`
- [ ] Run `npm run start` to verify it works
- [ ] Check logs to see which provider is being used
- [ ] That's it! ✅

## Common Questions

**Q: Do I need to update my `.env`?**
A: No. Your existing `.env` works as-is. Anthropic/Claude is the default.

**Q: Will agent behavior change?**
A: No. The interface is identical. Response times and quality might vary by provider, but behavior is the same.

**Q: Can I use multiple providers?**
A: Not simultaneously. Pick one provider via `LLM_PROVIDER`. To compare, run multiple instances with different configs.

**Q: Is my API key safe?**
A: Yes. API keys are only loaded from `.env` (never committed to git). Never share your `.env` file.

**Q: What if I want to go back to Claude?**
A: Just set:
```env
LLM_PROVIDER=anthropic
```

**Q: Which provider is best?**
A: Depends on your needs:
- **Quality**: Claude Opus or GPT-4
- **Cost**: Ollama (free) or Claude Haiku
- **Speed**: Ollama Mistral or GPT-3.5-turbo
- **Privacy**: Ollama (runs locally)

## Getting Help

### If it breaks:
1. Check that `LLM_PROVIDER` is set to a valid value
2. Check that the required API key is set
3. For Ollama, make sure it's running (`ollama serve`)
4. Check the console logs for error messages

### Documentation
- **Provider details**: `packages/simulation/src/llm/README.md`
- **Adding providers**: `packages/simulation/src/llm/providers/ADDING_PROVIDERS.md`
- **Setup guide**: `LLM_PROVIDER_SETUP.md` (in this repo)

## Testing Your Setup

```bash
# Verify Claude/Anthropic is working
echo "LLM_PROVIDER=anthropic" >> .env.local
npm run start

# Try Ollama (if installed)
echo "LLM_PROVIDER=ollama" >> .env.local
ollama pull llama2
ollama serve  # in another terminal
npm run start

# Check logs
# Should see something like:
# [INFO] LLM Provider: anthropic
# [INFO] Model: claude-haiku-4-5-20251001
```

## Next Steps

1. **Keep using Claude** (recommended for production)
2. **Try Ollama** for development (faster iteration, zero cost)
3. **Experiment with different models** to see which works best
4. **Add your own provider** if needed (see provider documentation)

---

For detailed information, see:
- [`LLM_PROVIDER_SETUP.md`](./LLM_PROVIDER_SETUP.md)
- [`packages/simulation/src/llm/README.md`](packages/simulation/src/llm/README.md)
- [`packages/simulation/src/llm/providers/ADDING_PROVIDERS.md`](packages/simulation/src/llm/providers/ADDING_PROVIDERS.md)
