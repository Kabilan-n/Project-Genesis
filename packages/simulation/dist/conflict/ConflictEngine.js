"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictEngine = void 0;
const db_js_1 = require("../db.js");
// ── Combat constants ─────────────────────────────────────────────────────────
const COMBAT_VARIANCE = 0.15; // ±15% random factor on combat power
const RAID_RESOURCE_PCT = 0.25; // winner loots 25% of loser's resources
const WAR_DECAY_TICKS = 2880; // auto-end war after ~2 days of no skirmishes
const TREATY_GRACE_TICKS = 2; // proposer waits 2 ticks for implicit acceptance
/**
 * ConflictEngine — Phase 5
 *
 * Handles the full lifecycle of inter-group conflict:
 *   - `declareWar`        — group A declares war on group B
 *   - `executeRaid`       — a single agent attacks another in the context of a war
 *   - `resolveSkirmish`   — deterministic combat resolution
 *   - `proposeTreaty`     — submit a peace proposal
 *   - `ratifyTreaty`      — defender implicitly accepts after grace period
 *   - `checkWarTermination` — end wars that have been quiet for WAR_DECAY_TICKS
 */
class ConflictEngine {
    // ── War declaration ──────────────────────────────────────────────────────────
    async declareWar(aggressorGroupId, defenderGroupId, worldId, tick, day) {
        // Check no active war already exists between these groups
        const existing = await (0, db_js_1.queryOne)(`SELECT war_id FROM conflict.wars
       WHERE world_id = $1
         AND ((aggressor_group_id = $2 AND defender_group_id = $3)
           OR (aggressor_group_id = $3 AND defender_group_id = $2))
         AND status = 'active'`, [worldId, aggressorGroupId, defenderGroupId]);
        if (existing)
            return null; // already at war
        const row = await (0, db_js_1.queryOne)(`INSERT INTO conflict.wars
         (world_id, aggressor_group_id, defender_group_id, status, declared_tick, declared_day)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING *`, [worldId, aggressorGroupId, defenderGroupId, tick, day]);
        if (!row)
            return null;
        // Update at_war_with arrays on both groups
        await (0, db_js_1.execute)(`UPDATE social.groups
       SET at_war_with = array_append(at_war_with, $2::uuid)
       WHERE group_id = $1`, [aggressorGroupId, defenderGroupId]);
        await (0, db_js_1.execute)(`UPDATE social.groups
       SET at_war_with = array_append(at_war_with, $2::uuid)
       WHERE group_id = $1`, [defenderGroupId, aggressorGroupId]);
        return row;
    }
    // ── Skirmish / raid ──────────────────────────────────────────────────────────
    /**
     * executeRaid — called when an agent chooses action `raid` against a target.
     * Resolves combat, applies HP damage, loots resources if attacker wins.
     */
    async executeRaid(attacker, defender, worldId, tick, day, warId) {
        const skirmish = this.resolveSkirmish(attacker, defender);
        // Apply HP damage
        await (0, db_js_1.execute)(`UPDATE agents.agent_state SET hp = GREATEST(0, hp - $2) WHERE agent_id = $1`, [attacker.agent_id, skirmish.hp_damage_attacker]);
        await (0, db_js_1.execute)(`UPDATE agents.agent_state SET hp = GREATEST(0, hp - $2) WHERE agent_id = $1`, [defender.agent_id, skirmish.hp_damage_defender]);
        // Loot resources on attacker win
        if (skirmish.outcome === 'attacker_won') {
            skirmish.resources_stolen = await this.lootResources(attacker.agent_id, defender.agent_id);
        }
        // Persist skirmish record
        const saved = await (0, db_js_1.queryOne)(`INSERT INTO conflict.skirmishes
         (world_id, war_id, attacker_id, defender_id,
          attacker_group_id, defender_group_id,
          location_x, location_y, tick, day,
          outcome, hp_damage_attacker, hp_damage_defender,
          attacker_power, defender_power, resources_stolen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`, [
            worldId,
            warId ?? null,
            attacker.agent_id,
            defender.agent_id,
            attacker.group_id ?? null,
            defender.group_id ?? null,
            attacker.state.position_x,
            attacker.state.position_y,
            tick,
            day,
            skirmish.outcome,
            skirmish.hp_damage_attacker,
            skirmish.hp_damage_defender,
            skirmish.attacker_power,
            skirmish.defender_power,
            JSON.stringify(skirmish.resources_stolen),
        ]);
        // Update war casualty counters
        if (warId) {
            if (attacker.group_id) {
                await (0, db_js_1.execute)(`UPDATE conflict.wars
           SET casualties_aggressor = casualties_aggressor + $2
           WHERE war_id = $1`, [warId, skirmish.hp_damage_attacker > 0 ? 1 : 0]);
            }
            if (defender.group_id) {
                await (0, db_js_1.execute)(`UPDATE conflict.wars
           SET casualties_defender = casualties_defender + $2
           WHERE war_id = $1`, [warId, skirmish.hp_damage_defender > 0 ? 1 : 0]);
            }
        }
        return saved ?? {
            ...skirmish,
            world_id: worldId,
            tick,
            day,
            location_x: attacker.state.position_x,
            location_y: attacker.state.position_y,
        };
    }
    /** Pure function — computes combat outcome without side effects */
    resolveSkirmish(attacker, defender) {
        const attackerPower = this.combatPower(attacker) * (1 + (Math.random() * 2 - 1) * COMBAT_VARIANCE);
        const defenderPower = this.combatPower(defender) * (1 + (Math.random() * 2 - 1) * COMBAT_VARIANCE);
        const attackerWins = attackerPower > defenderPower;
        // Defender can flee if hp < 30
        const defenderFlees = defender.state.hp < 30 && Math.random() < 0.5;
        const outcome = defenderFlees
            ? 'fled'
            : attackerWins ? 'attacker_won' : 'defender_won';
        // HP damage — loser takes more
        const hpDamageAttacker = attackerWins
            ? defenderPower * 0.3
            : defenderPower * 0.7;
        const hpDamageDefender = attackerWins
            ? attackerPower * 0.7
            : attackerPower * 0.3;
        return {
            attacker_id: attacker.agent_id,
            defender_id: defender.agent_id,
            outcome,
            hp_damage_attacker: Math.round(hpDamageAttacker * 10) / 10,
            hp_damage_defender: Math.round(hpDamageDefender * 10) / 10,
            attacker_power: Math.round(attackerPower * 100) / 100,
            defender_power: Math.round(defenderPower * 100) / 100,
            resources_stolen: {},
        };
    }
    /** Combat power = weighted combination of aggression, hp, and combat skill */
    combatPower(agent) {
        const aggression = agent.traits.aggression ?? 50;
        const hp = agent.state.hp;
        const combatSkill = agent.skills.find(s => s.skill_name === 'combat')?.level ?? 0;
        return (aggression * 0.4) + (hp * 0.3) + (combatSkill * 0.3);
    }
    /** Move RAID_RESOURCE_PCT of defender's inventory to attacker */
    async lootResources(attackerId, defenderId) {
        const rows = await (0, db_js_1.query)(`SELECT resource_type, amount FROM economy.inventory WHERE agent_id = $1`, [defenderId]);
        const looted = {};
        for (const row of rows) {
            const take = Math.floor(row.amount * RAID_RESOURCE_PCT);
            if (take <= 0)
                continue;
            looted[row.resource_type] = take;
            // Deduct from defender
            await (0, db_js_1.execute)(`UPDATE economy.inventory SET amount = amount - $2
         WHERE agent_id = $1 AND resource_type = $3`, [defenderId, take, row.resource_type]);
            // Add to attacker
            await (0, db_js_1.execute)(`INSERT INTO economy.inventory (agent_id, resource_type, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, resource_type)
         DO UPDATE SET amount = economy.inventory.amount + EXCLUDED.amount`, [attackerId, row.resource_type, take]);
        }
        return looted;
    }
    // ── Treaties ─────────────────────────────────────────────────────────────────
    async proposeTreaty(proposerGroupId, targetGroupId, treatyType, worldId, tick, day) {
        // Can't propose treaty when actively at war (war must be in ceasefire first)
        // But allow non_aggression as a way to end the war
        const row = await (0, db_js_1.queryOne)(`INSERT INTO conflict.treaties
         (world_id, group_a_id, group_b_id, treaty_type, status,
          proposed_tick, proposed_day, proposer_group_id)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $2)
       RETURNING *`, [worldId, proposerGroupId, targetGroupId, treatyType, tick, day]);
        return row ?? null;
    }
    /**
     * ratifyPendingTreaties — called each tick.
     * Any pending treaty older than TREATY_GRACE_TICKS is ratified
     * if no hostile action happened between the groups since proposal.
     */
    async ratifyPendingTreaties(worldId, tick) {
        const pending = await (0, db_js_1.query)(`SELECT * FROM conflict.treaties
       WHERE world_id = $1 AND status = 'pending'
         AND proposed_tick <= $2`, [worldId, tick - TREATY_GRACE_TICKS]);
        for (const treaty of pending) {
            // Check if a skirmish happened between the groups after proposal
            const hostile = await (0, db_js_1.queryOne)(`SELECT s.skirmish_id
         FROM conflict.skirmishes s
         JOIN agents.agents aa ON aa.agent_id = s.attacker_id
         JOIN agents.agents da ON da.agent_id = s.defender_id
         WHERE s.world_id = $1
           AND s.tick > $2
           AND (
             (aa.group_id = $3 AND da.group_id = $4)
             OR (aa.group_id = $4 AND da.group_id = $3)
           )
         LIMIT 1`, [worldId, treaty.proposed_tick, treaty.group_a_id, treaty.group_b_id]);
            if (!hostile) {
                // Ratify
                await (0, db_js_1.execute)(`UPDATE conflict.treaties
           SET status = 'active', ratified_tick = $2, ratified_day = $3
           WHERE treaty_id = $1`, [treaty.treaty_id, tick, Math.floor(tick / 1440)]);
                // If non_aggression treaty — end any active war between these groups
                if (treaty.treaty_type === 'non_aggression') {
                    await this.endWar(treaty.group_a_id, treaty.group_b_id, worldId, tick, Math.floor(tick / 1440), 'treaty');
                }
            }
        }
    }
    // ── War termination ──────────────────────────────────────────────────────────
    /**
     * checkWarTermination — called every tick.
     * Ends wars that have been inactive for WAR_DECAY_TICKS.
     */
    async checkWarTermination(worldId, tick) {
        const activeWars = await (0, db_js_1.query)(`SELECT * FROM conflict.wars WHERE world_id = $1 AND status = 'active'`, [worldId]);
        for (const war of activeWars) {
            // Find the most recent skirmish for this war
            const lastSkirmish = await (0, db_js_1.queryOne)(`SELECT tick FROM conflict.skirmishes
         WHERE war_id = $1
         ORDER BY tick DESC LIMIT 1`, [war.war_id]);
            const lastActiveTick = lastSkirmish?.tick ?? war.declared_tick;
            if (tick - lastActiveTick >= WAR_DECAY_TICKS) {
                // Determine winner by casualties
                let outcome;
                if (war.casualties_aggressor < war.casualties_defender) {
                    outcome = 'aggressor_victory';
                }
                else if (war.casualties_defender < war.casualties_aggressor) {
                    outcome = 'defender_victory';
                }
                else {
                    outcome = 'draw';
                }
                await this.endWar(war.aggressor_group_id, war.defender_group_id, worldId, tick, Math.floor(tick / 1440), outcome);
            }
        }
        // Also ratify pending treaties
        await this.ratifyPendingTreaties(worldId, tick);
    }
    async endWar(groupAId, groupBId, worldId, tick, day, outcome) {
        await (0, db_js_1.execute)(`UPDATE conflict.wars
       SET status = 'ended', ended_tick = $3, ended_day = $4, outcome = $5
       WHERE world_id = $1
         AND ((aggressor_group_id = $6 AND defender_group_id = $7)
           OR (aggressor_group_id = $7 AND defender_group_id = $6))
         AND status = 'active'`, [worldId, worldId, tick, day, outcome, groupAId, groupBId]);
        // Remove from at_war_with arrays
        await (0, db_js_1.execute)(`UPDATE social.groups
       SET at_war_with = array_remove(at_war_with, $2::uuid)
       WHERE group_id = $1`, [groupAId, groupBId]);
        await (0, db_js_1.execute)(`UPDATE social.groups
       SET at_war_with = array_remove(at_war_with, $2::uuid)
       WHERE group_id = $1`, [groupBId, groupAId]);
    }
    // ── Query helpers ─────────────────────────────────────────────────────────────
    async getActiveWar(groupAId, groupBId) {
        return (0, db_js_1.queryOne)(`SELECT * FROM conflict.wars
       WHERE ((aggressor_group_id = $1 AND defender_group_id = $2)
           OR (aggressor_group_id = $2 AND defender_group_id = $1))
         AND status = 'active'`, [groupAId, groupBId]);
    }
    async getWarsForGroup(groupId) {
        return (0, db_js_1.query)(`SELECT * FROM conflict.wars
       WHERE (aggressor_group_id = $1 OR defender_group_id = $1)
         AND status = 'active'`, [groupId]);
    }
    async getActiveTreaties(groupId) {
        return (0, db_js_1.query)(`SELECT * FROM conflict.treaties
       WHERE (group_a_id = $1 OR group_b_id = $1) AND status = 'active'`, [groupId]);
    }
}
exports.ConflictEngine = ConflictEngine;
