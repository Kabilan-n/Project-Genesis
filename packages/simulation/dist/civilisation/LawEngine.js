"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LawEngine = void 0;
const db_js_1 = require("../db.js");
// Minimum votes needed to pass a law (fraction of group members)
const QUORUM_FRACTION = 0.5;
// Ticks a law waits for votes before auto-deciding
const VOTE_WINDOW_TICKS = 720; // half a day
/**
 * LawEngine — Phase 5 Civilisation
 *
 * Manages group governance through laws:
 *   - `proposeLaw`      — agent proposes a rule to the group
 *   - `voteOnLaw`       — members vote for or against
 *   - `enactLaws`       — finalise laws that have reached quorum
 *   - `reportViolation` — agent reports another for breaking a law
 *   - `applyPenalty`    — execute the punishment for a violation
 *   - `runLawTick`      — called every tick to finalise pending votes
 */
class LawEngine {
    // ── Propose ───────────────────────────────────────────────────────────────────
    async proposeLaw(proposer, groupId, name, description, lawType, penaltyType, penaltyValue, worldId, tick) {
        // Only group members can propose laws
        const isMember = await (0, db_js_1.queryOne)(`SELECT agent_id FROM social.group_members WHERE group_id = $1 AND agent_id = $2`, [groupId, proposer.agent_id]);
        if (!isMember)
            return null;
        // Auto-vote: proposer votes for
        const law = await (0, db_js_1.queryOne)(`INSERT INTO civilisation.laws
         (world_id, group_id, name, description, law_type,
          penalty_type, penalty_value, votes_for, votes_against,
          status, proposed_by, proposed_tick)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,'proposed',$8,$9)
       RETURNING *`, [worldId, groupId, name, description, lawType,
            penaltyType, penaltyValue, proposer.agent_id, tick]);
        return law ?? null;
    }
    // ── Voting ────────────────────────────────────────────────────────────────────
    async voteOnLaw(voter, lawId, inFavour) {
        const law = await (0, db_js_1.queryOne)(`SELECT * FROM civilisation.laws WHERE law_id = $1 AND status = 'proposed'`, [lawId]);
        if (!law)
            return false;
        const isMember = await (0, db_js_1.queryOne)(`SELECT agent_id FROM social.group_members WHERE group_id = $1 AND agent_id = $2`, [law.group_id, voter.agent_id]);
        if (!isMember)
            return false;
        if (inFavour) {
            await (0, db_js_1.execute)(`UPDATE civilisation.laws SET votes_for = votes_for + 1 WHERE law_id = $1`, [lawId]);
        }
        else {
            await (0, db_js_1.execute)(`UPDATE civilisation.laws SET votes_against = votes_against + 1 WHERE law_id = $1`, [lawId]);
        }
        return true;
    }
    // ── Enactment ─────────────────────────────────────────────────────────────────
    /**
     * runLawTick — called every tick.
     * Finalises laws whose vote window has closed.
     */
    async runLawTick(worldId, tick) {
        const pending = await (0, db_js_1.query)(`SELECT l.*, g.member_count
       FROM civilisation.laws l
       JOIN social.groups g ON g.group_id = l.group_id
       WHERE l.world_id = $1 AND l.status = 'proposed'
         AND l.proposed_tick <= $2`, [worldId, tick - VOTE_WINDOW_TICKS]);
        for (const law of pending) {
            const memberCount = law.member_count ?? 1;
            const totalVotes = law.votes_for + law.votes_against;
            const quorum = totalVotes >= Math.ceil(memberCount * QUORUM_FRACTION);
            const passed = quorum && law.votes_for > law.votes_against;
            if (passed) {
                await (0, db_js_1.execute)(`UPDATE civilisation.laws SET status = 'active', enacted_tick = $2 WHERE law_id = $1`, [law.law_id, tick]);
            }
            else {
                // Failed or no quorum → repeal proposal
                await (0, db_js_1.execute)(`UPDATE civilisation.laws SET status = 'repealed' WHERE law_id = $1`, [law.law_id]);
            }
        }
    }
    // ── Violation detection ───────────────────────────────────────────────────────
    /**
     * checkForViolations — called after each agent action.
     * Returns any laws the agent may have violated.
     */
    async checkForViolations(agent, actionVerb, targetAgentId) {
        if (!agent.group_id)
            return [];
        const activeLaws = await this.getGroupLaws(agent.group_id);
        const violated = [];
        for (const law of activeLaws) {
            let violates = false;
            switch (law.law_type) {
                case 'behavior':
                    // Examples: "no_aggression" law violated by raid/denounce
                    if (['raid', 'exile_member', 'denounce'].includes(actionVerb))
                        violates = true;
                    break;
                case 'resource':
                    // "no_hoarding" — if agent has > 200 units of any resource
                    // (checked lazily here; full check happens in reportViolation)
                    break;
                case 'trade':
                    // Violations are reported by trade partners, not detected automatically
                    break;
                case 'territory':
                    // Agent left group territory — would need position check
                    break;
                case 'belief':
                    // Practicing a banned belief
                    break;
            }
            if (violates)
                violated.push(law);
        }
        return violated;
    }
    // ── Violation reporting ───────────────────────────────────────────────────────
    async reportViolation(reporter, violatorId, lawId, worldId, tick, day) {
        const law = await (0, db_js_1.queryOne)(`SELECT * FROM civilisation.laws WHERE law_id = $1 AND status = 'active'`, [lawId]);
        if (!law)
            return null;
        // Apply the penalty
        const penaltyLabel = await this.applyPenalty(violatorId, law, worldId, tick);
        const violation = await (0, db_js_1.queryOne)(`INSERT INTO civilisation.law_violations
         (world_id, law_id, violator_id, reporter_id, penalty_applied, tick, day)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`, [worldId, lawId, violatorId, reporter.agent_id, penaltyLabel, tick, day]);
        return violation ?? null;
    }
    async applyPenalty(violatorId, law, worldId, tick) {
        switch (law.penalty_type) {
            case 'relationship':
                // Reduce all group members' trust toward violator
                await (0, db_js_1.execute)(`UPDATE social.relationships r
           SET trust_score = GREATEST(0, trust_score - $3)
           FROM social.group_members gm
           WHERE r.other_agent_id = $1
             AND r.agent_id = gm.agent_id
             AND gm.group_id = $2`, [violatorId, law.group_id, law.penalty_value]);
                return `trust_reduced_by_${law.penalty_value}`;
            case 'resource_fine':
                // Deduct resources from violator's inventory (distributed to group leader)
                await (0, db_js_1.execute)(`UPDATE economy.inventory
           SET amount = GREATEST(0, amount - $2)
           WHERE agent_id = $1 AND resource_type = 'food'`, [violatorId, Math.floor(law.penalty_value)]);
                return `resource_fine_${law.penalty_value}`;
            case 'public_shame':
                // Lower violator's esteem and reputation
                await (0, db_js_1.execute)(`UPDATE agents.agent_state SET need_esteem = GREATEST(0, need_esteem - $2) WHERE agent_id = $1`, [violatorId, law.penalty_value]);
                await (0, db_js_1.execute)(`UPDATE social.reputations
           SET trustworthiness = GREATEST(0, trustworthiness - $2),
               negative_reports = negative_reports + 1,
               total_reports = total_reports + 1
           WHERE agent_id = $1`, [violatorId, law.penalty_value]);
                return `public_shame_-${law.penalty_value}_esteem`;
            case 'exile':
                // Mark for exile — actual removal triggered by GovernanceEngine
                return 'exile_pending';
            default:
                return 'no_penalty';
        }
    }
    // ── Query helpers ─────────────────────────────────────────────────────────────
    async getGroupLaws(groupId) {
        return (0, db_js_1.query)(`SELECT * FROM civilisation.laws WHERE group_id = $1 AND status = 'active'`, [groupId]);
    }
    async getGroupProposedLaws(groupId) {
        return (0, db_js_1.query)(`SELECT * FROM civilisation.laws WHERE group_id = $1 AND status = 'proposed'
       ORDER BY proposed_tick DESC`, [groupId]);
    }
    async getWorldLaws(worldId) {
        return (0, db_js_1.query)(`SELECT * FROM civilisation.laws WHERE world_id = $1 AND status = 'active'
       ORDER BY enacted_tick DESC`, [worldId]);
    }
    async getRecentViolations(worldId, limit = 20) {
        return (0, db_js_1.query)(`SELECT * FROM civilisation.law_violations WHERE world_id = $1
       ORDER BY tick DESC LIMIT $2`, [worldId, limit]);
    }
}
exports.LawEngine = LawEngine;
