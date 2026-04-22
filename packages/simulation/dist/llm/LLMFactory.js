"use strict";
/**
 * Factory for creating LLM clients based on provider configuration.
 * Supports: Anthropic (Claude), OpenAI, Ollama (local), and HuggingFace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMFactory = void 0;
const AnthropicClient_js_1 = require("./providers/AnthropicClient.js");
const OpenAIClient_js_1 = require("./providers/OpenAIClient.js");
const OllamaClient_js_1 = require("./providers/OllamaClient.js");
const HuggingFaceClient_js_1 = require("./providers/HuggingFaceClient.js");
class LLMFactory {
    static createClient(config) {
        switch (config.provider) {
            case 'anthropic':
                return new AnthropicClient_js_1.AnthropicClient(config.model, config.apiKey);
            case 'openai':
                return new OpenAIClient_js_1.OpenAIClient(config.model, config.apiKey);
            case 'ollama':
                return new OllamaClient_js_1.OllamaClient(config.model, config.baseUrl || 'http://localhost:11434');
            case 'huggingface':
                return new HuggingFaceClient_js_1.HuggingFaceClient(config.model, config.apiKey);
            default:
                throw new Error(`Unknown LLM provider: ${config.provider}`);
        }
    }
    static fromEnv() {
        const provider = (process.env.LLM_PROVIDER || 'anthropic');
        const model = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';
        const config = { provider, model };
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
            throw new Error(`Missing API key for provider: ${provider}`);
        }
        return this.createClient(config);
    }
}
exports.LLMFactory = LLMFactory;
