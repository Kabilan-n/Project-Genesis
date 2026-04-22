"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptBuilder = void 0;
class PromptBuilder {
    buildDecisionPrompt(agent, relationships, recentMemories, perception, worldTick, worldDay, 
    // Phase 3 extras (optional — backward compatible)
    knowledgeFacts = [], agentGroup = null, reputationSummary = '', nearbyGroups = []) {
        const timeOfDay = this.getTimeOfDay(worldTick);
        const nearbyAgentDetails = this.formatNearbyAgents(perception.nearby_agents, relationships);
        const groupSection = this.formatGroupSection(agentGroup, nearbyGroups);
        const knowledgeSection = this.formatKnowledgeSection(knowledgeFacts);
        const reputationLine = reputationSummary
            ? `Your reputation among others: ${reputationSummary}`
            : '';
        return `You are ${agent.name}, a person living in a world called Genesis. You are NOT an AI or a character — this is your actual life.

=== WHO YOU ARE ===
Name: ${agent.name}
Archetype: ${agent.archetype}
Age: ${worldTick - agent.birth_tick} minutes old (Day ${worldDay})
${reputationLine}

=== YOUR PERSONALITY ===
${this.formatTraits(agent.traits)}

=== YOUR CURRENT STATE ===
Health: ${Math.round(agent.state.hp)}/100 ${agent.state.hp < 30 ? '(CRITICAL)' : agent.state.hp < 60 ? '(hurting)' : '(good)'}
Mental State: ${agent.state.mental_state}
Hunger: ${this.needLabel(agent.state.need_food)} (${Math.round(agent.state.need_food)}/100)
Thirst: ${this.needLabel(agent.state.need_water)} (${Math.round(agent.state.need_water)}/100)
Energy: ${this.needLabel(agent.state.need_rest)} (${Math.round(agent.state.need_rest)}/100)
Belonging: ${Math.round(agent.state.need_belonging)}/100
Current Goal: ${agent.state.current_goal ?? 'none'}

=== YOUR SKILLS ===
${agent.skills.length > 0 ? agent.skills.map(s => `- ${s.skill_name}: Level ${s.level}`).join('\n') : '- Basic survival instincts only'}

=== YOUR INVENTORY ===
${agent.inventory.length > 0 ? agent.inventory.map(i => `- ${i.resource_type}: ${Math.round(i.amount)} units`).join('\n') : '- Nothing'}
${groupSection}${knowledgeSection}
=== PEOPLE NEARBY ===
${nearbyAgentDetails || 'No one nearby'}

=== RECENT MEMORIES ===
${recentMemories.length > 0 ? recentMemories.map(m => `- ${m}`).join('\n') : '- Nothing recent stands out'}

=== WHERE YOU ARE ===
Position: (${agent.state.position_x}, ${agent.state.position_y}) on the world map
Terrain: ${perception.current_tile.terrain}
Time: ${timeOfDay} of Day ${worldDay}
Can move: ${perception.passable_directions.join(', ')}

=== NEARBY RESOURCES ===
${perception.visible_resources.length > 0
            ? perception.visible_resources.map(r => `- ${r.resource_type}: ${Math.round(r.amount)} units at distance ${r.distance} (at ${r.x},${r.y})`).join('\n')
            : '- No resources visible from here'}

=== DECIDE WHAT TO DO ===
Based on who you are, what you need, and what you perceive — decide your next action.

Available actions:
- move [north/south/east/west] — walk one step
- gather [resource_type] — collect resources from your current location
- rest — sleep/rest to recover energy
- eat [amount] — consume food from inventory
- drink [amount] — consume water from inventory
- talk [agent_name] [opening_message] — start a conversation with someone nearby
- offer_trade [agent_name] — propose a trade (include trade_offer in JSON)
- gossip [listener_name] [subject_name] [claim] — share your opinion of someone with another agent
  (claim must be one of: trustworthy, dangerous, skilled, generous, deceptive, weak, heroic, cruel)
- form_group [group_name] [purpose] — found a new tribe or group
- join_group [group_name] — join an existing group nearby
- leave_group — leave your current group
- do_nothing — stand still and observe

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "thought": "your internal reasoning (1-2 sentences)",
  "action": "action string exactly as described above",
  "speech": "optional — what you say aloud",
  "gossip_subject": "optional — name of the person you're gossiping about",
  "gossip_claim": "optional — one of the claim values above",
  "group_name": "optional — name of the group to form or join",
  "group_purpose": "optional — purpose when forming a group"
}`;
    }
    formatTraits(traits) {
        const lines = [];
        if (traits.optimism > 65)
            lines.push('- You tend to see the bright side of things');
        if (traits.optimism < 35)
            lines.push('- You expect things to go badly');
        if (traits.extraversion > 65)
            lines.push('- You feel energized around others');
        if (traits.extraversion < 35)
            lines.push('- You prefer solitude');
        if (traits.empathy > 65)
            lines.push('- You deeply feel what others feel');
        if (traits.aggression > 65)
            lines.push('- You can be confrontational when threatened');
        if (traits.curiosity > 65)
            lines.push('- You are driven to explore and understand');
        if (traits.self_preservation > 65)
            lines.push('- Your survival instinct is strong');
        if (traits.trust_default < 30)
            lines.push('- You are suspicious of strangers');
        if (traits.impulsivity > 65)
            lines.push('- You act on instinct, not always planning ahead');
        if (traits.fear_of_rejection > 60)
            lines.push('- You fear being left out or rejected');
        if (traits.scarcity_anxiety > 60)
            lines.push('- You worry about not having enough');
        if (lines.length === 0)
            lines.push('- You are a fairly balanced individual');
        return lines.join('\n');
    }
    needLabel(value) {
        if (value > 80)
            return 'satisfied';
        if (value > 60)
            return 'ok';
        if (value > 40)
            return 'feeling it';
        if (value > 20)
            return 'urgent';
        return 'CRITICAL';
    }
    getTimeOfDay(tick) {
        const minuteOfDay = tick % 1440;
        if (minuteOfDay < 360)
            return 'pre-dawn';
        if (minuteOfDay < 720)
            return 'morning';
        if (minuteOfDay < 900)
            return 'midday';
        if (minuteOfDay < 1080)
            return 'afternoon';
        if (minuteOfDay < 1260)
            return 'evening';
        return 'night';
    }
    formatGroupSection(agentGroup, nearbyGroups) {
        const lines = ['\n=== YOUR GROUP ==='];
        if (agentGroup) {
            lines.push(`You are a member of: ${agentGroup.name}`);
            if (agentGroup.purpose)
                lines.push(`Group purpose: ${agentGroup.purpose}`);
            lines.push(`Members: ${agentGroup.member_count}`);
        }
        else {
            lines.push('You are not part of any group.');
        }
        if (nearbyGroups.length > 0) {
            lines.push('Nearby groups you could join:');
            for (const g of nearbyGroups) {
                lines.push(`  - ${g.name} (${g.member_count} members)${g.purpose ? ': ' + g.purpose : ''}`);
            }
        }
        return lines.join('\n') + '\n';
    }
    formatKnowledgeSection(knowledgeFacts) {
        if (knowledgeFacts.length === 0)
            return '';
        const lines = ['\n=== WHAT YOU KNOW ==='];
        for (const fact of knowledgeFacts) {
            const conf = fact.confidence >= 0.8 ? 'certain' : fact.confidence >= 0.5 ? 'fairly sure' : 'heard';
            lines.push(`- [${conf}] ${fact.fact_value}`);
        }
        return lines.join('\n') + '\n';
    }
    formatNearbyAgents(nearby, relationships) {
        if (nearby.length === 0)
            return '';
        return nearby.map(a => {
            const rel = relationships.find(r => r.other_agent_id === a.agent_id);
            const relDesc = rel ? `(${rel.relationship_type}, trust: ${rel.trust_score})` : '(stranger)';
            return `- ${a.name} ${relDesc} — ${a.activity} — ${a.distance} steps away`;
        }).join('\n');
    }
    // ── Phase 2: Conversation turn prompt ──────────────────────
    buildConversationTurnPrompt(speaker, listener, previousTurns, lastMessage, listenerRel, recentMemories, _tick, day, forceEnd) {
        const relDesc = listenerRel
            ? `${listenerRel.relationship_type} (trust: ${listenerRel.trust_score}, affection: ${listenerRel.affection_score})`
            : 'stranger';
        const history = previousTurns.map(t => `  ${t.speaker_name}: "${t.message}"`).join('\n');
        return `You are ${speaker.name}, a person in the world of Genesis. This is your actual life, not a game.

=== WHO YOU ARE ===
${this.formatTraits(speaker.traits)}
Mental state: ${speaker.state.mental_state} | HP: ${Math.round(speaker.state.hp)}/100

=== YOUR RELATIONSHIP WITH ${listener.name.toUpperCase()} ===
Relationship: ${relDesc}

=== RECENT MEMORIES ===
${recentMemories.length > 0 ? recentMemories.map(m => `- ${m}`).join('\n') : '- Nothing recent'}

=== CONVERSATION SO FAR (Day ${day}) ===
${history}

=== ${listener.name.toUpperCase()} JUST SAID TO YOU ===
"${lastMessage}"

${forceEnd ? '(This is the last exchange — bring the conversation to a natural close.)' : ''}

Respond as ${speaker.name}. Stay true to your personality and emotional state.

Reply ONLY with JSON:
{
  "thought": "your internal reaction (1 sentence)",
  "speech": "what you actually say aloud (1-3 sentences, natural dialogue)",
  "is_ending": ${forceEnd ? 'true' : 'false or true if you want to end the conversation'}
}`;
    }
    // ── Phase 2: Trade decision prompt ─────────────────────────
    buildTradeDecisionPrompt(receiver, offerer, offer, receiverInventory, relationship, _tick, _day) {
        const offeredList = Object.entries(offer.offered_items)
            .map(([r, a]) => `  ${Math.round(a)} ${r}`).join('\n') || '  nothing';
        const requestedList = Object.entries(offer.requested_items)
            .map(([r, a]) => `  ${Math.round(a)} ${r}`).join('\n') || '  nothing';
        const invList = receiverInventory
            .map(i => `  ${Math.round(i.amount)} ${i.resource_type}`).join('\n') || '  nothing';
        const relDesc = relationship
            ? `${relationship.relationship_type} (trust: ${relationship.trust_score})`
            : 'stranger';
        return `You are ${receiver.name}, a person in the world of Genesis.

=== YOUR PERSONALITY ===
${this.formatTraits(receiver.traits)}
Mental state: ${receiver.state.mental_state} | Hunger: ${this.needLabel(receiver.state.need_food)} | Thirst: ${this.needLabel(receiver.state.need_water)}

=== YOUR INVENTORY ===
${invList}

=== TRADE OFFER FROM ${offerer.name.toUpperCase()} ===
Your relationship: ${relDesc}

They offer you:
${offeredList}

They want in return:
${requestedList}

Decide whether to accept, reject, or make a counter-offer.
Consider: Is this fair? Do you need what they offer? Can you spare what they want? Do you trust them?

Reply ONLY with JSON:
{
  "thought": "your reasoning (1-2 sentences)",
  "decision": "accept" | "reject" | "counter",
  "reason": "brief explanation",
  "counter_offer": {
    "offered_items": { "resource_type": amount },
    "requested_items": { "resource_type": amount }
  }
}
(Include counter_offer only if decision is "counter", otherwise omit it.)`;
    }
}
exports.PromptBuilder = PromptBuilder;
