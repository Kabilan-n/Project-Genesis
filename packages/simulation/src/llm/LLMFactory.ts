/**
 * Factory for creating LLM clients based on provider configuration.
 * Supports: Anthropic (Claude), OpenAI, Ollama (local), and HuggingFace.
 */

import type { LLMClient } from './types.js';
import { AnthropicClient } from './providers/AnthropicClient.js';
import { OpenAIClient } from './providers/OpenAIClient.js';
import { OllamaClient } from './providers/OllamaClient.js';
import { HuggingFaceClient } from './providers/HuggingFaceClient.js';

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'huggingface';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export class LLMFactory {
  static createClient(config: LLMConfig): LLMClient {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicClient(config.model, config.apiKey);

      case 'openai':
        return new OpenAIClient(config.model, config.apiKey);

      case 'ollama':
        return new OllamaClient(
          config.model,
          config.baseUrl || 'http://localhost:11434'
        );

      case 'huggingface':
        return new HuggingFaceClient(config.model, config.apiKey);

      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }

  static fromEnv(): LLMClient {
    const provider = (process.env.LLM_PROVIDER || 'anthropic') as LLMProvider;
    const model = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';

    const config: LLMConfig = { provider, model };

    // Set provider-specific config
    switch (provider) {
      case 'anthropic':
        config.apiKey = process.env.ANTHROPIC_API_KEY;
        break;
      case 'openai':
        config.apiKey = process.env.OPENAI_API_KEY;
        break;
      case 'ollama':
        config.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        break;
      case 'huggingface':
        config.apiKey = process.env.HUGGINGFACE_API_KEY;
        break;
    }

    if (!config.apiKey && provider !== 'ollama') {
      // In test environments, allow missing keys — actual API calls will fail gracefully
      if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
        throw new Error(`Missing API key for provider: ${provider}`);
      }
      config.apiKey = 'test-key-placeholder';
    }

    return this.createClient(config);
  }
}
