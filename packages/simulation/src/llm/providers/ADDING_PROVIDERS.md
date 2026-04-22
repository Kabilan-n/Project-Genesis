# Adding a New LLM Provider

This guide explains how to add support for a new LLM provider (e.g., Groq, Together, Replicate, etc.).

## Step 1: Implement the `LLMClient` Interface

Create a new file: `src/llm/providers/YourProviderClient.ts`

```typescript
import type { AgentDecision } from '../../types.js';
import type { TradeResponse } from '../../social/TradeEngine.js';
import type { LLMClient, ConversationTurnResponse } from '../types.js';

export class YourProviderClient implements LLMClient {
  constructor(private model: string, private apiKey?: string) {}

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    try {
      const text = await this.call(prompt, 300);
      return this.parseDecision(text);
    } catch (err) {
      console.error('[YourProviderClient] Error:', err);
      return { thought: 'I feel confused.', action: 'do_nothing' };
    }
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    try {
      const text = await this.call(prompt, 250);
      return this.parseConversationTurn(text);
    } catch (err) {
      console.error('[YourProviderClient] Error:', err);
      return { thought: 'I am unsure how to respond.', speech: '...', is_ending: true };
    }
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    try {
      const text = await this.call(prompt, 250);
      return this.parseTradeResponse(text);
    } catch (err) {
      console.error('[YourProviderClient] Error:', err);
      return { decision: 'reject', thought: 'Something feels off.', reason: 'Uncertain' };
    }
  }

  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    return this.call(prompt, maxTokens);
  }

  // ── Private API Call ────────────────────────────────────────────

  private async call(prompt: string, maxTokens: number): Promise<string> {
    // Implement your API call here
    // Example using fetch:
    const response = await fetch('https://api.yourprovider.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as any;
    // Extract text from response (adjust based on API format)
    return data.choices[0]?.message?.content || '';
  }

  // ── Parsers (copy from AnthropicClient) ────────────────────────

  private parseDecision(text: string): AgentDecision {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.thought === 'string' && typeof parsed.action === 'string') {
        return {
          thought: parsed.thought,
          action: parsed.action,
          speech: typeof parsed.speech === 'string' ? parsed.speech : undefined,
          target: typeof parsed.target === 'string' ? parsed.target : undefined,
          trade_offer: parsed.trade_offer ?? undefined,
          gossip_subject: typeof parsed.gossip_subject === 'string' ? parsed.gossip_subject : undefined,
          gossip_claim: typeof parsed.gossip_claim === 'string' ? parsed.gossip_claim as any : undefined,
          group_name: typeof parsed.group_name === 'string' ? parsed.group_name : undefined,
          group_purpose: typeof parsed.group_purpose === 'string' ? parsed.group_purpose : undefined,
        };
      }
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }
    return { thought: 'I am not sure what to do.', action: 'do_nothing' };
  }

  private parseConversationTurn(text: string): ConversationTurnResponse {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return {
        thought:    typeof parsed.thought    === 'string'  ? parsed.thought    : 'thinking...',
        speech:     typeof parsed.speech     === 'string'  ? parsed.speech     : '...',
        is_ending:  typeof parsed.is_ending  === 'boolean' ? parsed.is_ending  : false,
      };
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const p = JSON.parse(match[0]);
          return {
            thought:   p.thought   ?? 'thinking...',
            speech:    p.speech    ?? text.slice(0, 150),
            is_ending: p.is_ending ?? false,
          };
        } catch { /* fall through */ }
      }
    }
    return { thought: 'Unsure.', speech: text.slice(0, 150).trim(), is_ending: true };
  }

  private parseTradeResponse(text: string): TradeResponse {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      const decision = ['accept', 'reject', 'counter'].includes(parsed.decision)
        ? parsed.decision as TradeResponse['decision']
        : 'reject';
      return {
        decision,
        thought: parsed.thought ?? 'Considering the offer...',
        counter_offer: parsed.counter_offer ?? undefined,
        reason: parsed.reason ?? undefined,
      };
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }
    return { decision: 'reject', thought: 'Something felt off.', reason: 'Unclear offer' };
  }
}
```

## Step 2: Update the Factory

Edit `src/llm/LLMFactory.ts`:

```typescript
import { YourProviderClient } from './providers/YourProviderClient.js';

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'huggingface' | 'your-provider';

export class LLMFactory {
  static createClient(config: LLMConfig): LLMClient {
    // ... existing cases ...

    case 'your-provider':
      return new YourProviderClient(
        config.model,
        config.apiKey || process.env.YOUR_PROVIDER_API_KEY
      );

    // ... rest of switch ...
  }

  static fromEnv(): LLMClient {
    // ... existing code ...

    switch (provider) {
      // ... existing cases ...
      case 'your-provider':
        config.apiKey = process.env.YOUR_PROVIDER_API_KEY;
        break;
    }

    // ... rest of method ...
  }
}
```

## Step 3: Update Environment Configuration

Update `.env` and `.env.example`:

```env
# LLM Provider & Model Configuration
LLM_PROVIDER=your-provider
LLM_MODEL=your-model-name
YOUR_PROVIDER_API_KEY=api_key_here
```

## Step 4: Documentation

Update the main `README.md` in this directory:

```markdown
### 5. **Your Provider**
Best for: [Description]

```env
LLM_PROVIDER=your-provider
LLM_MODEL=your-model-name
YOUR_PROVIDER_API_KEY=...
```

**Common models:**
- `model1` — Description
- `model2` — Description

[Get API key](https://yourprovider.com/keys)
```

## Step 5: Optional - Handle External Dependencies

If your provider requires an external SDK that might not be installed:

```typescript
export class YourProviderClient implements LLMClient {
  private client: any;

  constructor(private model: string, apiKey?: string) {
    let YourSDK: any;
    try {
      // eslint-disable-next-line global-require
      YourSDK = require('your-sdk').default;
    } catch {
      throw new Error(
        'Your SDK not installed. To use YourProvider, run: npm install your-sdk'
      );
    }

    this.client = new YourSDK({ apiKey });
  }

  // ... rest of implementation ...
}
```

## Step 6: Test It

1. Set environment variables in `.env`
2. Run the simulation:
   ```bash
   npm run start
   ```
3. Verify logs show your provider is being used

## Example: Adding Groq Provider

```typescript
// src/llm/providers/GroqClient.ts
import type { LLMClient, ConversationTurnResponse } from '../types.js';

export class GroqClient implements LLMClient {
  private client: any;

  constructor(private model: string, apiKey?: string) {
    // Groq SDK or just use fetch
    this.client = {
      apiKey: apiKey || process.env.GROQ_API_KEY,
    };
  }

  private async call(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.client.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });

    const data = await response.json() as any;
    return data.choices[0]?.message?.content || '';
  }

  // ... implement all 4 methods using this.call() ...
}
```

## Tips

1. **Reuse the parsers**: All providers should use the same response parsers (they're provider-agnostic)
2. **Error handling**: Always catch API errors and return sensible defaults
3. **Token limits**: Respect `maxTokens` parameter for consistency
4. **Testing**: Add a test file to verify the parsers work with your provider's response format
5. **Async operations**: Use `async/await` consistently
6. **Environment variables**: Use uppercase names like `YOUR_PROVIDER_API_KEY`

## Common API Patterns

### OpenAI-Compatible (Groq, Together, Replicate)
```typescript
const response = await fetch(baseUrl + '/chat/completions', {
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  }),
});
const data = await response.json();
return data.choices[0].message.content;
```

### Completion Endpoint (Legacy)
```typescript
const response = await fetch(baseUrl + '/completions', {
  body: JSON.stringify({
    model,
    prompt,
    max_tokens: maxTokens,
  }),
});
const data = await response.json();
return data.choices[0].text;
```

### Inference API (HuggingFace style)
```typescript
const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
  body: JSON.stringify({ inputs: prompt }),
});
const data = await response.json();
return data[0].generated_text;
```

Good luck adding your provider! 🎉
