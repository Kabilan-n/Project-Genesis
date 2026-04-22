"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
class OllamaClient {
    model;
    baseUrl;
    constructor(model, baseUrl) {
        this.model = model;
        this.baseUrl = baseUrl;
    }
    async getAgentDecision(prompt) {
        try {
            const text = await this.call(prompt, 300);
            return this.parseDecision(text);
        }
        catch (err) {
            console.error('[OllamaClient] Error calling API:', err);
            return { thought: 'I feel confused.', action: 'do_nothing' };
        }
    }
    async getConversationResponse(prompt) {
        try {
            const text = await this.call(prompt, 250);
            return this.parseConversationTurn(text);
        }
        catch (err) {
            console.error('[OllamaClient] Conversation error:', err);
            return { thought: 'I am unsure how to respond.', speech: '...', is_ending: true };
        }
    }
    async getTradeResponse(prompt) {
        try {
            const text = await this.call(prompt, 250);
            return this.parseTradeResponse(text);
        }
        catch (err) {
            console.error('[OllamaClient] Trade error:', err);
            return { decision: 'reject', thought: 'Something feels off.', reason: 'Uncertain' };
        }
    }
    async getRawCompletion(prompt, maxTokens = 100) {
        return this.call(prompt, maxTokens);
    }
    async call(prompt, maxTokens) {
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                prompt,
                stream: false,
                options: {
                    num_predict: maxTokens,
                },
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.response;
    }
    // ── Parsers ──────────────────────────────────────────────
    parseDecision(text) {
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
                    gossip_claim: typeof parsed.gossip_claim === 'string' ? parsed.gossip_claim : undefined,
                    group_name: typeof parsed.group_name === 'string' ? parsed.group_name : undefined,
                    group_purpose: typeof parsed.group_purpose === 'string' ? parsed.group_purpose : undefined,
                };
            }
        }
        catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                }
                catch { /* fall through */ }
            }
        }
        return { thought: 'I am not sure what to do.', action: 'do_nothing' };
    }
    parseConversationTurn(text) {
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        try {
            const parsed = JSON.parse(cleaned);
            return {
                thought: typeof parsed.thought === 'string' ? parsed.thought : 'thinking...',
                speech: typeof parsed.speech === 'string' ? parsed.speech : '...',
                is_ending: typeof parsed.is_ending === 'boolean' ? parsed.is_ending : false,
            };
        }
        catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    const p = JSON.parse(match[0]);
                    return {
                        thought: p.thought ?? 'thinking...',
                        speech: p.speech ?? text.slice(0, 150),
                        is_ending: p.is_ending ?? false,
                    };
                }
                catch { /* fall through */ }
            }
        }
        return { thought: 'Unsure.', speech: text.slice(0, 150).trim(), is_ending: true };
    }
    parseTradeResponse(text) {
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        try {
            const parsed = JSON.parse(cleaned);
            const decision = ['accept', 'reject', 'counter'].includes(parsed.decision)
                ? parsed.decision
                : 'reject';
            return {
                decision,
                thought: parsed.thought ?? 'Considering the offer...',
                counter_offer: parsed.counter_offer ?? undefined,
                reason: parsed.reason ?? undefined,
            };
        }
        catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                }
                catch { /* fall through */ }
            }
        }
        return { decision: 'reject', thought: 'Something felt off.', reason: 'Unclear offer' };
    }
}
exports.OllamaClient = OllamaClient;
