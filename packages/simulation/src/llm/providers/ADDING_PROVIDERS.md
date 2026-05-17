# Adding a New LLM Provider

Step-by-step guide for adding a new provider (Groq, Together, Replicate,
local fine-tunes, etc.). Reflects the post-stabilization shape: shared
Zod parsing, circuit breaker, structured logging, no regex fallback.

## What you get for free

The framework already provides four shared modules — your provider only
implements the API call:

| Module | What it does |
|--------|--------------|
| `llm/schemas.ts` | Zod schemas for decision / conversation / trade responses |
| `llm/defaults.ts` | `SAFE_DEFAULT_*` sentinels returned on parse / call failure |
| `llm/parsing.ts` | `parseDecision`, `parseConversationTurn`, `parseTradeResponse` — strip code fences → JSON.parse → schema validate → metric on failure → safe default |
| `llm/breaker.ts` | `BREAKER_OPTIONS` (15s timeout, 50% error threshold, 30s reset) + `attachBreakerEvents` to wire it into metrics |

`OpenAIClient`, `OllamaClient`, `HuggingFaceClient`, and `AnthropicClient`
all follow the same template; copy the closest one as a starting point.

## Step 1: Implement the client

Create `src/llm/providers/YourProviderClient.ts`:

```typescript
import CircuitBreaker from 'opossum';
import type { AgentDecision } from '../../types.js';
import type { TradeResponse } from '../../social/TradeEngine.js';
import type { LLMClient, ConversationTurnResponse } from '../types.js';
import {
  parseDecision, parseConversationTurn, parseTradeResponse,
} from '../parsing.js';
import {
  SAFE_DEFAULT_DECISION, SAFE_DEFAULT_CONVERSATION_TURN, SAFE_DEFAULT_TRADE_RESPONSE,
} from '../defaults.js';
import { metrics } from '../../observability/metrics.js';
import { BREAKER_OPTIONS, attachBreakerEvents } from '../breaker.js';

const PROVIDER = 'your-provider';

type CompletionFn = (args: { prompt: string; maxTokens: number }) => Promise<string>;

export class YourProviderClient implements LLMClient {
  private completionBreaker: CircuitBreaker<Parameters<CompletionFn>, string>;

  constructor(private model: string, private apiKey?: string) {
    const completion: CompletionFn = ({ prompt, maxTokens }) => this.call(prompt, maxTokens);
    this.completionBreaker = new CircuitBreaker(completion, BREAKER_OPTIONS);
    attachBreakerEvents(this.completionBreaker, { label: PROVIDER });
  }

  private async safeCompletion(prompt: string, maxTokens: number): Promise<string | null> {
    try { return await this.completionBreaker.fire({ prompt, maxTokens }); }
    catch { return null; }
  }

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    const text = await this.safeCompletion(prompt, 300);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'decision', provider: PROVIDER });
      return SAFE_DEFAULT_DECISION;
    }
    return parseDecision(text, PROVIDER);
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'conversation', provider: PROVIDER });
      return SAFE_DEFAULT_CONVERSATION_TURN;
    }
    return parseConversationTurn(text, PROVIDER);
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'trade', provider: PROVIDER });
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
    return parseTradeResponse(text, PROVIDER);
  }

  /**
   * Raw completion deliberately bypasses the breaker — its callers
   * (MemoryDecay.consolidateBatch) already have retry + deterministic
   * fallback. Double-counting failures here would trip the breaker
   * prematurely.
   */
  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    return this.call(prompt, maxTokens);
  }

  // ── The only provider-specific bit ──────────────────────────────────

  private async call(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch('https://api.your-provider.com/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`YourProvider API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.choices[0]?.message?.content ?? '';
  }
}
```

## Step 2: Wire into `LLMFactory`

Edit `src/llm/LLMFactory.ts`:

```typescript
import { YourProviderClient } from './providers/YourProviderClient.js';

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'huggingface' | 'your-provider';

// In createClient(config):
case 'your-provider':
  return new YourProviderClient(config.model, config.apiKey);

// In fromEnv():
case 'your-provider':
  config.apiKey = process.env.YOUR_PROVIDER_API_KEY;
  break;
```

## Step 3: Environment config

Add to `.env.example`:

```env
LLM_PROVIDER=your-provider
LLM_MODEL=your-model-name
YOUR_PROVIDER_API_KEY=
```

## Step 4: Optional SDK

If your provider has a TypeScript SDK that you don't want as a hard
dependency (so users only install it if they pick this provider), use
the `require` pattern from `OpenAIClient`:

```typescript
let YourSDK: any;
try { YourSDK = require('your-sdk').default; }
catch {
  throw new Error('Your SDK not installed. Run: npm install your-sdk');
}
this.client = new YourSDK({ apiKey });
```

## Tips

1. **Never bypass the parser.** Always go through `parseDecision` etc.
   — they handle code fences, schema validation, metrics, and safe
   defaults uniformly across providers.
2. **Don't add ad-hoc field extraction.** If the LLM's output doesn't
   match the schema, that's a signal for the operator (via the
   `llm_parse_failure` log + `llmParseFailures` metric), not a fixup
   target.
3. **Provider label matters.** Pass `PROVIDER` to every metric inc and
   every parser call. The /metrics endpoint slices by provider so you
   can tell which one is misbehaving.
4. **Keep `getRawCompletion` raw.** No breaker, no parser. Callers handle
   their own retries.

## Reference implementations

| File | Style | Notes |
|------|-------|-------|
| `AnthropicClient.ts` | SDK | Anthropic SDK, hardcoded as default |
| `OpenAIClient.ts` | SDK with optional require | Lazy SDK load |
| `OllamaClient.ts` | Raw fetch | Local-hosted, no auth |
| `HuggingFaceClient.ts` | Raw fetch | Inference API |

Copy whichever shape matches your provider, replace the `call` method,
update the `PROVIDER` constant.
