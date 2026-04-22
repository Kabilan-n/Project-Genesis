"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChronicleEngine = void 0;
const db_js_1 = require("../db.js");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001';
// How many in-game days each chronicle era spans
const ERA_LENGTH_DAYS = 10;
// Minimum significant events required to generate a chronicle
const MIN_EVENTS_FOR_CHRONICLE = 5;
/**
 * ChronicleEngine — Phase 5 Civilisation
 *
 * Generates an LLM-written historical narrative for each era of the world:
 *   - `generateChronicle`  — produce a chronicle for a completed era
 *   - `shouldGenerate`     — check if it's time to write a new chronicle
 *   - `getWorldHistory`    — return all chronicles in order
 */
class ChronicleEngine {
    client;
    constructor() {
        this.client = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    // ── Chronicle generation ──────────────────────────────────────────────────────
    /**
     * shouldGenerate — returns true when a new era has ended and hasn't been chronicled.
     * Called once per day in the simulation loop.
     */
    async shouldGenerate(worldId, currentDay) {
        const world = await (0, db_js_1.queryOne)(`SELECT last_chronicle_day FROM worlds.worlds WHERE world_id = $1`, [worldId]);
        if (!world)
            return false;
        const nextEraEnd = world.last_chronicle_day + ERA_LENGTH_DAYS;
        return currentDay >= nextEraEnd;
    }
    /**
     * generateChronicle — builds and persists a narrative for an era.
     * Gathers major/historic events, groups/wars/beliefs context, then asks Claude
     * to write a historical account in the style of an ancient chronicler.
     */
    async generateChronicle(worldId, currentDay, currentTick) {
        const world = await (0, db_js_1.queryOne)(`SELECT last_chronicle_day FROM worlds.worlds WHERE world_id = $1`, [worldId]);
        if (!world)
            return null;
        const eraStartDay = world.last_chronicle_day;
        const eraEndDay = eraStartDay + ERA_LENGTH_DAYS;
        // Gather significant events for this era
        const events = await (0, db_js_1.query)(`SELECT event_id, title, COALESCE(summary,'') AS summary, event_type, significance, day
       FROM events.events
       WHERE world_id = $1
         AND day >= $2 AND day < $3
         AND significance IN ('major','historic','moderate')
       ORDER BY day ASC
       LIMIT 40`, [worldId, eraStartDay, eraEndDay]);
        if (events.length < MIN_EVENTS_FOR_CHRONICLE) {
            // Not enough happened — still update last_chronicle_day to avoid spamming
            await (0, db_js_1.execute)(`UPDATE worlds.worlds SET last_chronicle_day = $2 WHERE world_id = $1`, [worldId, eraEndDay]);
            return null;
        }
        // Gather world context
        const [groups, wars, beliefs, population] = await Promise.all([
            (0, db_js_1.query)(`SELECT name, member_count FROM social.groups WHERE world_id = $1 AND status = 'active'`, [worldId]),
            (0, db_js_1.query)(`SELECT outcome, declared_day FROM conflict.wars
         WHERE world_id = $1 AND (declared_day >= $2 OR ended_day >= $2)`, [worldId, eraStartDay]),
            (0, db_js_1.query)(`SELECT name, adherent_count, core_tenet FROM culture.belief_systems
         WHERE world_id = $1 AND is_extinct = FALSE`, [worldId]),
            (0, db_js_1.queryOne)(`SELECT COUNT(*) as count FROM agents.agents WHERE world_id = $1 AND status = 'alive'`, [worldId]),
        ]);
        // Build context string for LLM
        const groupSummary = groups.map(g => `${g.name} (${g.member_count} members)`).join(', ');
        const warSummary = wars.length > 0 ? `${wars.length} wars/conflicts` : 'no major wars';
        const beliefSummary = beliefs.map(b => `"${b.name}" (tenet: ${b.core_tenet})`).join('; ');
        const eventLines = events.map(e => `Day ${e.day}: [${e.significance}] ${e.title}${e.summary ? ' — ' + e.summary : ''}`).join('\n');
        const prompt = `You are the chronicler of a primordial world, writing the official historical record.
Write a vivid, narrative account (3-5 paragraphs) of Days ${eraStartDay} through ${eraEndDay} in this world.
Use an ancient, authoritative tone — like a scribe documenting history for posterity.

WORLD CONTEXT:
- Living groups: ${groupSummary || 'none yet formed'}
- Conflict: ${warSummary}
- Beliefs: ${beliefSummary || 'no organised beliefs yet'}
- Population: ${population?.count ?? 0} souls alive

KEY EVENTS OF THIS ERA:
${eventLines}

First, give this era a dramatic name on the first line (e.g. "The Age of First Fires" or "The Era of Broken Alliances").
Then write the narrative. Focus on the most dramatic and consequential events. Make it feel like real history.`;
        let rawNarrative = '';
        try {
            const response = await this.client.messages.create({
                model: MODEL,
                max_tokens: 800,
                messages: [{ role: 'user', content: prompt }],
            });
            rawNarrative = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
        }
        catch (err) {
            console.error('[ChronicleEngine] LLM error:', err);
            rawNarrative = `Days ${eraStartDay}–${eraEndDay}: An era of ${events.length} significant events, including ${events[0]?.title ?? 'many changes'}.`;
        }
        // Extract era name from first line if the LLM provided it
        const lines = rawNarrative.split('\n').filter(l => l.trim());
        let eraName = `Days ${eraStartDay}–${eraEndDay}`;
        let narrative = rawNarrative;
        if (lines.length > 1 && lines[0].length < 80) {
            eraName = lines[0].replace(/^["*#]|["*#]$/g, '').trim();
            narrative = lines.slice(1).join('\n').trim();
        }
        const keyEvents = events.slice(0, 10).map(e => ({
            event_id: e.event_id,
            title: e.title,
            day: e.day,
        }));
        const chronicle = await (0, db_js_1.queryOne)(`INSERT INTO civilisation.chronicles
         (world_id, era_start_day, era_end_day, era_name, narrative, key_events, generated_tick)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`, [worldId, eraStartDay, eraEndDay, eraName, narrative, JSON.stringify(keyEvents), currentTick]);
        // Update last_chronicle_day
        await (0, db_js_1.execute)(`UPDATE worlds.worlds SET last_chronicle_day = $2 WHERE world_id = $1`, [worldId, eraEndDay]);
        return chronicle ?? null;
    }
    // ── Query helpers ─────────────────────────────────────────────────────────────
    async getWorldHistory(worldId) {
        return (0, db_js_1.query)(`SELECT * FROM civilisation.chronicles WHERE world_id = $1 ORDER BY era_start_day ASC`, [worldId]);
    }
    async getLatestChronicle(worldId) {
        return (0, db_js_1.queryOne)(`SELECT * FROM civilisation.chronicles WHERE world_id = $1 ORDER BY era_start_day DESC LIMIT 1`, [worldId]);
    }
}
exports.ChronicleEngine = ChronicleEngine;
