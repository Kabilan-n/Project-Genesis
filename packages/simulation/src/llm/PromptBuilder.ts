/**
 * Unified prompt builder.
 *
 * Two output modes share the same classification logic (which traits matter,
 * which urgency tier the agent is in, etc.) and differ only in formatting:
 *
 *   verbose — prose `=== HEADER ===` blocks. Default. Better for low-context
 *             models and easier to debug. ~600–800 tokens / decision prompt.
 *   compact — terse `key:value` style with empty sections omitted.
 *             ~150–250 tokens / decision prompt.
 *
 * Mode is selected at construction. Callers should derive it from the
 * OPTIMIZE_PROMPTS env var: `OPTIMIZE_PROMPTS === 'true'` → 'compact'.
 */
import type {
  Agent, AgentTraits, PerceptionContext, Relationship,
  ConversationTurn, TradeOffer, AgentKnowledge, Group,
} from '../types.js';

export type PromptMode = 'verbose' | 'compact';

export function resolvePromptMode(envValue: string | undefined): PromptMode {
  if (envValue === 'true' || envValue === 'compact') return 'compact';
  if (envValue && envValue !== 'false' && envValue !== 'verbose') {
    console.warn(`[PromptBuilder] Unknown OPTIMIZE_PROMPTS value "${envValue}", defaulting to verbose`);
  }
  return 'verbose';
}

export class PromptBuilder {
  constructor(public readonly mode: PromptMode = 'verbose') {}

  // ── Public API ───────────────────────────────────────────────────────────

  buildDecisionPrompt(
    agent: Agent,
    relationships: Relationship[],
    recentMemories: string[],
    perception: PerceptionContext,
    worldTick: number,
    worldDay: number,
    knowledgeFacts: AgentKnowledge[] = [],
    agentGroup: Group | null = null,
    reputationSummary: string = '',
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }> = [],
  ): string {
    return this.mode === 'compact'
      ? this.buildDecisionCompact(agent, relationships, recentMemories, perception,
          worldTick, worldDay, knowledgeFacts, agentGroup, reputationSummary, nearbyGroups)
      : this.buildDecisionVerbose(agent, relationships, recentMemories, perception,
          worldTick, worldDay, knowledgeFacts, agentGroup, reputationSummary, nearbyGroups);
  }

  buildConversationTurnPrompt(
    speaker: Agent,
    listener: Agent,
    previousTurns: ConversationTurn[],
    lastMessage: string,
    listenerRel: Relationship | null,
    recentMemories: string[],
    tick: number,
    day: number,
    forceEnd: boolean,
    partnerHistory: string[] = [],
    partnerMemories: string[] = [],
  ): string {
    return this.mode === 'compact'
      ? this.buildConversationCompact(speaker, listener, previousTurns, lastMessage,
          listenerRel, recentMemories, tick, day, forceEnd, partnerHistory, partnerMemories)
      : this.buildConversationVerbose(speaker, listener, previousTurns, lastMessage,
          listenerRel, recentMemories, tick, day, forceEnd, partnerHistory, partnerMemories);
  }

  buildTradeDecisionPrompt(
    receiver: Agent,
    offerer: Agent,
    offer: TradeOffer,
    receiverInventory: Array<{ resource_type: string; amount: number }>,
    relationship: { trust_score: number; relationship_type: string } | null,
    tick: number,
    day: number,
  ): string {
    return this.mode === 'compact'
      ? this.buildTradeCompact(receiver, offerer, offer, receiverInventory, relationship, tick, day)
      : this.buildTradeVerbose(receiver, offerer, offer, receiverInventory, relationship, tick, day);
  }

  // ── Verbose decision prompt ──────────────────────────────────────────────

  private buildDecisionVerbose(
    agent: Agent,
    relationships: Relationship[],
    recentMemories: string[],
    perception: PerceptionContext,
    worldTick: number,
    worldDay: number,
    knowledgeFacts: AgentKnowledge[],
    agentGroup: Group | null,
    reputationSummary: string,
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }>,
  ): string {
    const timeOfDay = this.getTimeOfDay(worldTick);
    const nearbyAgentDetails = this.formatNearbyAgentsVerbose(perception.nearby_agents, relationships);
    const groupSection = this.formatGroupSectionVerbose(agentGroup, nearbyGroups);
    const knowledgeSection = this.formatKnowledgeSectionVerbose(knowledgeFacts);
    const reputationLine = reputationSummary ? `Your reputation among others: ${reputationSummary}` : '';

    return `You are ${agent.name}, a person living in a world called Genesis. You are NOT an AI or a character — this is your actual life.

=== WHO YOU ARE ===
Name: ${agent.name}
Archetype: ${agent.archetype}
Age: ${worldTick - agent.birth_tick} minutes old (Day ${worldDay})
${reputationLine}

=== YOUR PERSONALITY ===
${this.formatTraitsVerbose(agent.traits)}

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
  ? perception.visible_resources.map(r =>
      `- ${r.resource_type}: ${Math.round(r.amount)} units at distance ${r.distance} (at ${r.x},${r.y})`
    ).join('\n')
  : '- No resources visible from here'}

${this.buildUrgencyVerbose(agent)}
=== DECIDE WHAT TO DO ===
Based on who you are, what you need, and what you perceive — decide your next action.
${this.buildEmotionalVerbose(agent)}
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

  // ── Compact decision prompt ──────────────────────────────────────────────

  private buildDecisionCompact(
    agent: Agent,
    relationships: Relationship[],
    recentMemories: string[],
    perception: PerceptionContext,
    worldTick: number,
    worldDay: number,
    knowledgeFacts: AgentKnowledge[],
    agentGroup: Group | null,
    reputationSummary: string,
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }>,
  ): string {
    const s = agent.state;
    const needs: string[] = [];
    if (s.need_food  < 40) needs.push(`food:${Math.round(s.need_food)}`);
    if (s.need_water < 40) needs.push(`water:${Math.round(s.need_water)}`);
    if (s.need_rest  < 30) needs.push(`rest:${Math.round(s.need_rest)}`);

    const inv = agent.inventory.filter(i => i.amount > 0)
      .map(i => `${Math.round(i.amount)}${i.resource_type[0]}`).join(' ');

    const nearby = perception.nearby_agents.slice(0, 3).map(a => {
      const rel = relationships.find(r => r.other_agent_id === a.agent_id);
      const trust = rel ? ` t${rel.trust_score}` : ' stranger';
      return `${a.name}(${a.distance}${trust})`;
    }).join(', ');

    const resources = perception.visible_resources.slice(0, 4)
      .map(r => `${r.resource_type}@${r.distance}`).join(' ');

    const memories = recentMemories.slice(0, 3).map(m => `• ${m.slice(0, 80)}`).join('\n');
    const traits   = this.formatTraitsCompact(agent.traits);
    const group    = agentGroup ? `group:${agentGroup.name}` : 'no group';
    const rep      = reputationSummary ? `rep:${reputationSummary.slice(0, 60)}` : '';

    const parts: string[] = [
      `${agent.name} | ${agent.archetype} | Day ${worldDay} ${this.getTimeOfDay(worldTick)}`,
      `hp:${Math.round(s.hp)} mood:${s.mental_state} ${group}`,
      traits ? `traits: ${traits}` : '',
      needs.length   ? `NEEDS: ${needs.join(' ')}` : '',
      inv            ? `inv: ${inv}` : '',
      nearby         ? `nearby: ${nearby}` : '',
      resources      ? `resources: ${resources}` : '',
      rep,
      memories       ? `memories:\n${memories}` : '',
      knowledgeFacts.length ? `knows: ${knowledgeFacts.slice(0, 3).map(f => f.fact_value.slice(0, 60)).join('; ')}` : '',
      nearbyGroups.length ? `joinable groups: ${nearbyGroups.slice(0, 2).map(g => g.name).join(', ')}` : '',
    ].filter(Boolean);

    const urgency = this.buildUrgencyCompact(s);
    if (urgency) parts.push(urgency);

    const emo = this.buildEmotionalCompact(agent);
    if (emo) parts.push(emo);

    return parts.join('\n') + `

Actions: move N/S/E/W | gather [type] | rest | eat [n] | drink [n] | talk [name] [msg] | offer_trade [name] | gossip [listener] [subject] [claim] | form_group [name] [purpose] | join_group [name] | leave_group | do_nothing

JSON only:
{"thought":"1 sentence","action":"...","speech":"optional","gossip_subject":"opt","gossip_claim":"opt","group_name":"opt","group_purpose":"opt"}`;
  }

  // ── Verbose conversation prompt ──────────────────────────────────────────

  private buildConversationVerbose(
    speaker: Agent, listener: Agent,
    previousTurns: ConversationTurn[], lastMessage: string,
    listenerRel: Relationship | null, recentMemories: string[],
    _tick: number, day: number, forceEnd: boolean,
    partnerHistory: string[], partnerMemories: string[],
  ): string {
    const relDesc = listenerRel
      ? `${listenerRel.relationship_type} (trust: ${listenerRel.trust_score}, affection: ${listenerRel.affection_score})`
      : 'stranger';

    const history = previousTurns.map(t => `  ${t.speaker_name}: "${t.message}"`).join('\n');

    const priorBlock = partnerHistory.length > 0
      ? `\n=== YOUR PAST CONVERSATIONS WITH ${listener.name.toUpperCase()} ===\n` +
        partnerHistory.map(s => `- ${s}`).join('\n') + '\n'
      : '';

    const partnerMemBlock = partnerMemories.length > 0
      ? `\n=== WHAT YOU REMEMBER ABOUT ${listener.name.toUpperCase()} ===\n` +
        partnerMemories.map(s => `- ${s}`).join('\n') + '\n'
      : '';

    return `You are ${speaker.name}, a person in the world of Genesis. This is your actual life, not a game.

=== WHO YOU ARE ===
${this.formatTraitsVerbose(speaker.traits)}
Mental state: ${speaker.state.mental_state} | HP: ${Math.round(speaker.state.hp)}/100

=== YOUR RELATIONSHIP WITH ${listener.name.toUpperCase()} ===
Relationship: ${relDesc}
${priorBlock}${partnerMemBlock}
=== RECENT MEMORIES (general) ===
${recentMemories.length > 0 ? recentMemories.map(m => `- ${m}`).join('\n') : '- Nothing recent'}

=== CONVERSATION SO FAR (Day ${day}) ===
${history}

=== ${listener.name.toUpperCase()} JUST SAID TO YOU ===
"${lastMessage}"

${forceEnd ? '(This is the last exchange — bring the conversation to a natural close.)' : ''}

Respond as ${speaker.name}. Stay true to your personality and emotional state. Build on your shared history with ${listener.name} where relevant — don't introduce yourself again if you've spoken before.

Reply ONLY with JSON:
{
  "thought": "your internal reaction (1 sentence)",
  "speech": "what you actually say aloud (1-3 sentences, natural dialogue)",
  "is_ending": ${forceEnd ? 'true' : 'false or true if you want to end the conversation'}
}`;
  }

  // ── Compact conversation prompt ──────────────────────────────────────────

  private buildConversationCompact(
    speaker: Agent, listener: Agent,
    previousTurns: ConversationTurn[], lastMessage: string,
    listenerRel: Relationship | null, recentMemories: string[],
    _tick: number, day: number, forceEnd: boolean,
    partnerHistory: string[], partnerMemories: string[],
  ): string {
    const relDesc = listenerRel
      ? `${listenerRel.relationship_type} trust:${listenerRel.trust_score}`
      : 'stranger';
    const history = previousTurns.slice(-4).map(t => `${t.speaker_name}: "${t.message}"`).join('\n');
    const traits  = this.formatTraitsCompact(speaker.traits);
    const mem     = recentMemories.slice(0, 2).map(m => `• ${m.slice(0, 70)}`).join('\n');
    const pHist   = partnerHistory.slice(0, 3).map(s => `• ${s}`).join('\n');
    const pMem    = partnerMemories.slice(0, 3).map(s => `• ${s.slice(0, 80)}`).join('\n');

    return `${speaker.name} (${speaker.state.mental_state}${traits ? ', ' + traits : ''})
with ${listener.name} [${relDesc}] Day ${day}
${pHist ? `prior with ${listener.name}:\n` + pHist + '\n' : ''}${pMem ? `you remember about ${listener.name}:\n` + pMem + '\n' : ''}${mem ? 'recent memories:\n' + mem + '\n' : ''}${history ? 'chat:\n' + history + '\n' : ''}${listener.name}: "${lastMessage}"
${forceEnd ? '(wrap up conversation)' : ''}
JSON only: {"thought":"1 sentence","speech":"1-3 sentences","is_ending":${forceEnd ? 'true' : 'false or true'}}`;
  }

  // ── Verbose trade prompt ─────────────────────────────────────────────────

  private buildTradeVerbose(
    receiver: Agent, offerer: Agent, offer: TradeOffer,
    receiverInventory: Array<{ resource_type: string; amount: number }>,
    relationship: { trust_score: number; relationship_type: string } | null,
    _tick: number, _day: number,
  ): string {
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
${this.formatTraitsVerbose(receiver.traits)}
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

  // ── Compact trade prompt ─────────────────────────────────────────────────

  private buildTradeCompact(
    receiver: Agent, offerer: Agent, offer: TradeOffer,
    receiverInventory: Array<{ resource_type: string; amount: number }>,
    relationship: { trust_score: number; relationship_type: string } | null,
    _tick: number, _day: number,
  ): string {
    const gives = Object.entries(offer.offered_items).map(([r, a]) => `${Math.round(a)}${r}`).join(' ');
    const wants = Object.entries(offer.requested_items).map(([r, a]) => `${Math.round(a)}${r}`).join(' ');
    const inv   = receiverInventory.filter(i => i.amount > 0).map(i => `${Math.round(i.amount)}${i.resource_type}`).join(' ');
    const rel   = relationship ? `${relationship.relationship_type} t${relationship.trust_score}` : 'stranger';

    return `${receiver.name} (${receiver.state.mental_state}, food:${this.needLabelCompact(receiver.state.need_food)} water:${this.needLabelCompact(receiver.state.need_water)})
inv: ${inv || 'nothing'}
${offerer.name} [${rel}] offers ${gives || 'nothing'} wants ${wants || 'nothing'}
JSON only: {"thought":"1-2 sentences","decision":"accept"|"reject"|"counter","reason":"brief","counter_offer":{"offered_items":{},"requested_items":{}}}
(include counter_offer only if counter)`;
  }

  // ── Shared classification logic ──────────────────────────────────────────
  // Trait classification, urgency tiers, and emotional triggers are
  // identical across modes; only their textual rendering differs.

  /** Trait flags shared by both formatters. */
  private classifyTraits(t: AgentTraits): string[] {
    const tags: string[] = [];
    if (t.optimism > 65)        tags.push('optimistic');
    else if (t.optimism < 35)   tags.push('pessimistic');
    if (t.extraversion > 65)    tags.push('extrovert');
    else if (t.extraversion < 35) tags.push('introvert');
    if (t.empathy > 65)         tags.push('empathetic');
    if (t.aggression > 65)      tags.push('aggressive');
    if (t.curiosity > 65)       tags.push('curious');
    if (t.self_preservation > 65) tags.push('cautious');
    if (t.trust_default < 30)   tags.push('distrustful');
    if (t.impulsivity > 65)     tags.push('impulsive');
    if (t.fear_of_rejection > 60) tags.push('approval-seeking');
    if (t.scarcity_anxiety > 60) tags.push('hoarder');
    return tags;
  }

  private formatTraitsVerbose(traits: AgentTraits): string {
    const lines: string[] = [];
    if (traits.optimism > 65) lines.push('- You tend to see the bright side of things');
    if (traits.optimism < 35) lines.push('- You expect things to go badly');
    if (traits.extraversion > 65) lines.push('- You feel energized around others');
    if (traits.extraversion < 35) lines.push('- You prefer solitude');
    if (traits.empathy > 65) lines.push('- You deeply feel what others feel');
    if (traits.aggression > 65) lines.push('- You can be confrontational when threatened');
    if (traits.curiosity > 65) lines.push('- You are driven to explore and understand');
    if (traits.self_preservation > 65) lines.push('- Your survival instinct is strong');
    if (traits.trust_default < 30) lines.push('- You are suspicious of strangers');
    if (traits.impulsivity > 65) lines.push('- You act on instinct, not always planning ahead');
    if (traits.fear_of_rejection > 60) lines.push('- You fear being left out or rejected');
    if (traits.scarcity_anxiety > 60) lines.push('- You worry about not having enough');
    if (lines.length === 0) lines.push('- You are a fairly balanced individual');
    return lines.join('\n');
  }

  private formatTraitsCompact(t: AgentTraits): string {
    return this.classifyTraits(t).slice(0, 4).join(', ');
  }

  private needLabel(value: number): string {
    if (value > 80) return 'satisfied';
    if (value > 60) return 'ok';
    if (value > 40) return 'feeling it';
    if (value > 20) return 'urgent';
    return 'CRITICAL';
  }

  private needLabelCompact(v: number): string {
    if (v > 60) return 'ok';
    if (v > 30) return 'low';
    return 'crit';
  }

  private getTimeOfDay(tick: number): string {
    const minuteOfDay = tick % 1440;
    if (minuteOfDay < 360) return 'pre-dawn';
    if (minuteOfDay < 720) return 'morning';
    if (minuteOfDay < 900) return 'midday';
    if (minuteOfDay < 1080) return 'afternoon';
    if (minuteOfDay < 1260) return 'evening';
    return 'night';
  }

  // ── Verbose / compact section helpers ────────────────────────────────────

  private formatGroupSectionVerbose(
    agentGroup: Group | null,
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }>,
  ): string {
    const lines: string[] = ['\n=== YOUR GROUP ==='];
    if (agentGroup) {
      lines.push(`You are a member of: ${agentGroup.name}`);
      if (agentGroup.purpose) lines.push(`Group purpose: ${agentGroup.purpose}`);
      lines.push(`Members: ${agentGroup.member_count}`);
    } else {
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

  private formatKnowledgeSectionVerbose(knowledgeFacts: AgentKnowledge[]): string {
    if (knowledgeFacts.length === 0) return '';
    const lines = ['\n=== WHAT YOU KNOW ==='];
    for (const fact of knowledgeFacts) {
      const conf = fact.confidence >= 0.8 ? 'certain' : fact.confidence >= 0.5 ? 'fairly sure' : 'heard';
      lines.push(`- [${conf}] ${fact.fact_value}`);
    }
    return lines.join('\n') + '\n';
  }

  private formatNearbyAgentsVerbose(
    nearby: PerceptionContext['nearby_agents'],
    relationships: Relationship[],
  ): string {
    if (nearby.length === 0) return '';
    return nearby.map(a => {
      const rel = relationships.find(r => r.other_agent_id === a.agent_id);
      const relDesc = rel ? `(${rel.relationship_type}, trust: ${rel.trust_score})` : '(stranger)';
      return `- ${a.name} ${relDesc} — ${a.activity} — ${a.distance} steps away`;
    }).join('\n');
  }

  // ── Verbose urgency / emotional blocks ──────────────────────────────────

  private buildUrgencyVerbose(agent: Agent): string {
    const s = agent.state;
    const lines: string[] = [];

    if (s.need_food < 10 || s.need_water < 10) {
      lines.push('=== !! SURVIVAL CRISIS — YOU ARE DYING !! ===');
      if (s.need_food < 10)  lines.push(`You are STARVING. Your stomach is a hot knot of pain. Your hands tremble. The edges of your vision darken. Every breath takes effort. If you do not eat NOW, you will collapse and die within hours.`);
      if (s.need_water < 10) lines.push(`You are dying of THIRST. Your tongue is swollen, your throat cracked. The world spins when you move. Your heart pounds wrong. Without water, you have MINUTES — not hours — left.`);
      lines.push('HARD RULE: you may ONLY choose actions that lead to eating, drinking, or moving toward the nearest food/water. You physically cannot socialize, trade, craft, or wander. Any other choice is a self-destruct command.');
      lines.push('If you have food/water in inventory → eat/drink it this turn. If not → move toward the nearest visible resource. There is no third option.');
    } else if (s.need_food < 25 || s.need_water < 25) {
      lines.push('=== !! URGENT NEED !! ===');
      if (s.need_food < 25) lines.push(`Your stomach is hollow and aching. A dull panic rises whenever you think about food — and you cannot stop thinking about food. Your fingers feel cold. Finding food is OVERWHELMINGLY your priority.`);
      if (s.need_water < 25) lines.push(`Your mouth tastes of copper. Your throat burns. A low headache has settled behind your eyes and every movement feels heavier than it should. You MUST drink soon.`);
      lines.push('You may only consider non-survival actions (talking, trading, exploring) if there is literally no food or water available anywhere you can reach. Otherwise: eat, drink, or move toward resources.');
    } else if (s.need_food < 40 || s.need_water < 40) {
      lines.push('=== GROWING HUNGER/THIRST ===');
      if (s.need_food < 40) lines.push(`A gnawing hunger has started. You find yourself scanning the ground, the trees, your memory of where food was. It is distracting.`);
      if (s.need_water < 40) lines.push(`Your mouth is dry. You keep swallowing nothing. You should probably drink soon before it gets worse.`);
      lines.push('Getting food/water should weigh heavily in your choice, but brief social or task actions are still acceptable.');
    }

    if (s.need_rest < 10 && s.is_awake) {
      lines.push('You can barely keep your eyes open. Your limbs are lead. Each blink fights to stay shut. If you do not sleep very soon your body will decide for you. Find shelter and REST this turn.');
    } else if (s.need_rest < 25 && s.is_awake) {
      lines.push('You are profoundly exhausted. Your thoughts slip and double. Any complex decision feels like wading through mud. You should rest before attempting anything demanding.');
    }

    if (s.hp < 20) {
      lines.push(`Your body is failing. HP: ${Math.round(s.hp)}/100. Your pulse is thready, your breathing shallow. You are close to death. Every action this turn MUST serve keeping you alive — rest, eat, drink, or flee to safety.`);
    } else if (s.hp < 40) {
      lines.push(`You are injured and weak. HP: ${Math.round(s.hp)}/100. You feel fragile and afraid. Aggressive or risky actions feel suicidal right now.`);
    }

    return lines.length > 0 ? '\n' + lines.join('\n') + '\n' : '';
  }

  private buildEmotionalVerbose(agent: Agent): string {
    const s = agent.state;
    const t = agent.traits;
    const lines: string[] = [];

    if (s.need_belonging < 15) {
      lines.push('You feel deeply lonely. A hollow ache in your chest. You crave any human connection.');
    } else if (s.need_belonging < 30) {
      lines.push('You feel isolated. It has been too long since you had a real conversation.');
    }

    if (s.need_esteem < 20) {
      lines.push('You feel worthless and unimportant. You question whether anyone values you.');
    }

    if (t.scarcity_anxiety > 60 && s.need_food < 50) {
      lines.push('Your scarcity anxiety is flaring — you feel a compulsive need to hoard food and resources.');
    }
    if (t.fear_of_rejection > 60 && s.need_belonging < 40) {
      lines.push('You desperately want to connect with someone, but you are terrified of being rejected.');
    }
    if (t.aggression > 65 && (s.mental_state === 'stressed' || s.mental_state === 'desperate')) {
      lines.push('Frustration is building inside you. You feel an urge to lash out.');
    }
    if (t.optimism < 30 && s.hp < 60) {
      lines.push('A dark voice in your head whispers that things will only get worse.');
    }
    if (t.impulsivity > 65) {
      lines.push('You feel restless and impatient. You want to act NOW, not think.');
    }

    if (lines.length === 0) return '';
    return '\n=== HOW YOU FEEL ===\n' + lines.join('\n') + '\n';
  }

  // ── Compact urgency / emotional blocks ──────────────────────────────────

  private buildUrgencyCompact(s: Agent['state']): string {
    const parts: string[] = [];
    if (s.need_food < 10 || s.need_water < 10) {
      parts.push('!! DYING-hard override, survival-only this turn:');
      if (s.need_food < 10) parts.push('STARVING:vision darkening, stomach cramping-eat inventory or move to nearest food');
      if (s.need_water < 10) parts.push('DYING OF THIRST:tongue swollen, heart wrong-drink now or move to water');
      parts.push('NO social/trade/craft actions permitted');
    } else if (s.need_food < 25 || s.need_water < 25) {
      parts.push('!! URGENT:');
      if (s.need_food < 25) parts.push('hollow gnawing hunger-prioritize food');
      if (s.need_water < 25) parts.push('burning dry throat-prioritize water');
      parts.push('only skip survival if literally no resources reachable');
    } else if (s.need_food < 40 || s.need_water < 40) {
      if (s.need_food < 40) parts.push('hungry-food soon');
      if (s.need_water < 40) parts.push('thirsty-water soon');
    }
    if (s.need_rest < 10 && s.is_awake) parts.push('lead limbs, eyes sliding shut-REST this turn');
    else if (s.need_rest < 25 && s.is_awake) parts.push('exhausted-foggy thoughts');
    if (s.hp < 20) parts.push(`HP ${Math.round(s.hp)}-near death, survival-only actions`);
    else if (s.hp < 40) parts.push(`HP ${Math.round(s.hp)}-injured, fragile`);
    return parts.length > 0 ? parts.join(' ') : '';
  }

  private buildEmotionalCompact(agent: Agent): string {
    const s = agent.state;
    const t = agent.traits;
    const parts: string[] = [];
    if (s.need_belonging < 15) parts.push('deeply lonely');
    else if (s.need_belonging < 30) parts.push('isolated');
    if (s.need_esteem < 20) parts.push('feels worthless');
    if (t.scarcity_anxiety > 60 && s.need_food < 50) parts.push('hoarding anxiety');
    if (t.fear_of_rejection > 60 && s.need_belonging < 40) parts.push('fears rejection');
    if (t.aggression > 65 && (s.mental_state === 'stressed' || s.mental_state === 'desperate')) parts.push('rage building');
    if (t.optimism < 30 && s.hp < 60) parts.push('hopeless');
    return parts.length > 0 ? `feels: ${parts.join(', ')}` : '';
  }
}
