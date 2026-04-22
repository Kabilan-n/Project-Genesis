/**
 * Token-optimised prompt builder.
 *
 * Philosophy:
 *  - Use terse key=value style rather than prose headers
 *  - Omit sections that are empty or irrelevant (no resources → skip)
 *  - Collapse traits to a comma list of dominant ones only
 *  - Cap memories at 3, nearby agents at 3, knowledge at 3
 *  - Keep JSON schema short (field names abbreviated where unambiguous)
 *  - Target: ~150-250 tokens per decision prompt vs ~600-800 original
 */

import type {
  Agent, AgentTraits, PerceptionContext, Relationship,
  ConversationTurn, TradeOffer, AgentKnowledge, Group,
} from '../types.js';
import type { ConversationTurnResponse } from './types.js';
import type { TradeResponse } from '../social/TradeEngine.js';

export class PromptBuilderOptimised {

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
    const traits   = this.compactTraits(agent.traits);
    const group    = agentGroup ? `group:${agentGroup.name}` : 'no group';
    const rep      = reputationSummary ? `rep:${reputationSummary.slice(0, 60)}` : '';

    const parts: string[] = [
      `${agent.name} | ${agent.archetype} | Day ${worldDay} ${this.tod(worldTick)}`,
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

    // Urgency injection
    const urgency = this.buildUrgencyCompact(s);
    if (urgency) parts.push(urgency);

    // Emotional context
    const emo = this.buildEmotionalCompact(agent);
    if (emo) parts.push(emo);

    return parts.join('\n') + `

Actions: move N/S/E/W | gather [type] | rest | eat [n] | drink [n] | talk [name] [msg] | offer_trade [name] | gossip [listener] [subject] [claim] | form_group [name] [purpose] | join_group [name] | leave_group | do_nothing

JSON only:
{"thought":"1 sentence","action":"...","speech":"optional","gossip_subject":"opt","gossip_claim":"opt","group_name":"opt","group_purpose":"opt"}`;
  }

  buildConversationTurnPrompt(
    speaker: Agent,
    listener: Agent,
    previousTurns: ConversationTurn[],
    lastMessage: string,
    listenerRel: Relationship | null,
    recentMemories: string[],
    _tick: number,
    day: number,
    forceEnd: boolean,
  ): string {
    const relDesc = listenerRel
      ? `${listenerRel.relationship_type} trust:${listenerRel.trust_score}`
      : 'stranger';
    const history = previousTurns.slice(-4).map(t => `${t.speaker_name}: "${t.message}"`).join('\n');
    const traits  = this.compactTraits(speaker.traits);
    const mem     = recentMemories.slice(0, 2).map(m => `• ${m.slice(0, 70)}`).join('\n');

    return `${speaker.name} (${speaker.state.mental_state}${traits ? ', ' + traits : ''})
with ${listener.name} [${relDesc}] Day ${day}
${mem ? 'memories:\n' + mem + '\n' : ''}${history ? 'chat:\n' + history + '\n' : ''}${listener.name}: "${lastMessage}"
${forceEnd ? '(wrap up conversation)' : ''}
JSON only: {"thought":"1 sentence","speech":"1-3 sentences","is_ending":${forceEnd ? 'true' : 'false or true'}}`;
  }

  buildTradeDecisionPrompt(
    receiver: Agent,
    offerer: Agent,
    offer: TradeOffer,
    receiverInventory: Array<{ resource_type: string; amount: number }>,
    relationship: { trust_score: number; relationship_type: string } | null,
    _tick: number,
    _day: number,
  ): string {
    const gives = Object.entries(offer.offered_items).map(([r, a]) => `${Math.round(a)}${r}`).join(' ');
    const wants = Object.entries(offer.requested_items).map(([r, a]) => `${Math.round(a)}${r}`).join(' ');
    const inv   = receiverInventory.filter(i => i.amount > 0).map(i => `${Math.round(i.amount)}${i.resource_type}`).join(' ');
    const rel   = relationship ? `${relationship.relationship_type} t${relationship.trust_score}` : 'stranger';

    return `${receiver.name} (${receiver.state.mental_state}, food:${this.needLbl(receiver.state.need_food)} water:${this.needLbl(receiver.state.need_water)})
inv: ${inv || 'nothing'}
${offerer.name} [${rel}] offers ${gives || 'nothing'} wants ${wants || 'nothing'}
JSON only: {"thought":"1-2 sentences","decision":"accept"|"reject"|"counter","reason":"brief","counter_offer":{"offered_items":{},"requested_items":{}}}
(include counter_offer only if counter)`;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

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

  private compactTraits(t: AgentTraits): string {
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
    return tags.slice(0, 4).join(', ');
  }

  private tod(tick: number): string {
    const m = tick % 1440;
    if (m < 360)  return 'pre-dawn';
    if (m < 720)  return 'morning';
    if (m < 900)  return 'midday';
    if (m < 1080) return 'afternoon';
    if (m < 1260) return 'evening';
    return 'night';
  }

  private needLbl(v: number): string {
    if (v > 60) return 'ok';
    if (v > 30) return 'low';
    return 'crit';
  }
}
