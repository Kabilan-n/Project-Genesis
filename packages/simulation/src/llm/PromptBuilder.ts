import type {
  Agent, AgentTraits, PerceptionContext, Relationship,
  ConversationTurn, TradeOffer, AgentKnowledge, Group
} from '../types.js';

interface ConflictContext {
  active_wars: Array<{ enemy_group_name: string; casualties_friendly: number }>;
  nearby_enemies: Array<{ name: string; group_name: string; distance: number }>;
  active_treaties: Array<{ group_name: string; treaty_type: string }>;
}

interface BeliefContext {
  own_belief?: { name: string; conviction: number; prescribes_ritual: boolean };
  nearby_preachers: Array<{ name: string; belief_name: string; conviction: number }>;
  nearby_sacred_sites: Array<{ name: string; belief_name: string; x: number; y: number }>;
}

interface CivilisationContext {
  active_laws?: Array<{ name: string; description: string; penalty_type: string }>;
  nearby_markets?: Array<{ name: string; distance: number }>;
  group_techs?: string[];   // tech names known by agent's group
  unlocked_actions?: string[];
}

export class PromptBuilder {
  buildDecisionPrompt(
    agent: Agent,
    relationships: Relationship[],
    recentMemories: string[],
    perception: PerceptionContext,
    worldTick: number,
    worldDay: number,
    // Phase 3 extras (optional — backward compatible)
    knowledgeFacts: AgentKnowledge[] = [],
    agentGroup: Group | null = null,
    reputationSummary: string = '',
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }> = []
  ): string {
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
  ? perception.visible_resources.map(r =>
      `- ${r.resource_type}: ${Math.round(r.amount)} units at distance ${r.distance} (at ${r.x},${r.y})`
    ).join('\n')
  : '- No resources visible from here'}

${this.buildUrgencyBlock(agent)}
=== DECIDE WHAT TO DO ===
Based on who you are, what you need, and what you perceive — decide your next action.
${this.buildEmotionalContext(agent)}
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

  private formatTraits(traits: AgentTraits): string {
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

  private needLabel(value: number): string {
    if (value > 80) return 'satisfied';
    if (value > 60) return 'ok';
    if (value > 40) return 'feeling it';
    if (value > 20) return 'urgent';
    return 'CRITICAL';
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

  private formatGroupSection(
    agentGroup: Group | null,
    nearbyGroups: Array<{ name: string; member_count: number; purpose?: string }>
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

  private formatKnowledgeSection(knowledgeFacts: AgentKnowledge[]): string {
    if (knowledgeFacts.length === 0) return '';
    const lines = ['\n=== WHAT YOU KNOW ==='];
    for (const fact of knowledgeFacts) {
      const conf = fact.confidence >= 0.8 ? 'certain' : fact.confidence >= 0.5 ? 'fairly sure' : 'heard';
      lines.push(`- [${conf}] ${fact.fact_value}`);
    }
    return lines.join('\n') + '\n';
  }

  private formatNearbyAgents(
    nearby: PerceptionContext['nearby_agents'],
    relationships: Relationship[]
  ): string {
    if (nearby.length === 0) return '';
    return nearby.map(a => {
      const rel = relationships.find(r => r.other_agent_id === a.agent_id);
      const relDesc = rel ? `(${rel.relationship_type}, trust: ${rel.trust_score})` : '(stranger)';
      return `- ${a.name} ${relDesc} — ${a.activity} — ${a.distance} steps away`;
    }).join('\n');
  }

  private buildUrgencyBlock(agent: Agent): string {
    const s = agent.state;
    const lines: string[] = [];

    // Starvation / dehydration urgency — hard override at crisis level
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

    // Exhaustion
    if (s.need_rest < 10 && s.is_awake) {
      lines.push('You can barely keep your eyes open. Your limbs are lead. Each blink fights to stay shut. If you do not sleep very soon your body will decide for you. Find shelter and REST this turn.');
    } else if (s.need_rest < 25 && s.is_awake) {
      lines.push('You are profoundly exhausted. Your thoughts slip and double. Any complex decision feels like wading through mud. You should rest before attempting anything demanding.');
    }

    // HP crisis
    if (s.hp < 20) {
      lines.push(`Your body is failing. HP: ${Math.round(s.hp)}/100. Your pulse is thready, your breathing shallow. You are close to death. Every action this turn MUST serve keeping you alive — rest, eat, drink, or flee to safety.`);
    } else if (s.hp < 40) {
      lines.push(`You are injured and weak. HP: ${Math.round(s.hp)}/100. You feel fragile and afraid. Aggressive or risky actions feel suicidal right now.`);
    }

    return lines.length > 0 ? '\n' + lines.join('\n') + '\n' : '';
  }

  private buildEmotionalContext(agent: Agent): string {
    const s = agent.state;
    const t = agent.traits;
    const lines: string[] = [];

    // Loneliness / social needs
    if (s.need_belonging < 15) {
      lines.push('You feel deeply lonely. A hollow ache in your chest. You crave any human connection.');
    } else if (s.need_belonging < 30) {
      lines.push('You feel isolated. It has been too long since you had a real conversation.');
    }

    // Self-esteem
    if (s.need_esteem < 20) {
      lines.push('You feel worthless and unimportant. You question whether anyone values you.');
    }

    // Emotional flavor from traits
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

  // ── Phase 2: Conversation turn prompt ──────────────────────

  buildConversationTurnPrompt(
    speaker: Agent,
    listener: Agent,
    previousTurns: ConversationTurn[],
    lastMessage: string,
    listenerRel: Relationship | null,
    recentMemories: string[],
    _tick: number,
    day: number,
    forceEnd: boolean
  ): string {
    const relDesc = listenerRel
      ? `${listenerRel.relationship_type} (trust: ${listenerRel.trust_score}, affection: ${listenerRel.affection_score})`
      : 'stranger';

    const history = previousTurns.map(t =>
      `  ${t.speaker_name}: "${t.message}"`
    ).join('\n');

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

  buildTradeDecisionPrompt(
    receiver: Agent,
    offerer: Agent,
    offer: TradeOffer,
    receiverInventory: Array<{ resource_type: string; amount: number }>,
    relationship: { trust_score: number; relationship_type: string } | null,
    _tick: number,
    _day: number
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
