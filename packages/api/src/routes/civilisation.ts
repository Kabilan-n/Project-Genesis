import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

export async function civilisationRoutes(app: FastifyInstance) {

  // ── Phase 5: Conflict ──────────────────────────────────────────────────────

  // All wars in a world
  app.get('/worlds/:id/wars', async (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    const params: any[] = [id];
    const statusClause = status ? `AND w.status = $2` : '';
    if (status) params.push(status);
    return query<any>(
      `SELECT w.*,
              ag.name as aggressor_name, ag.colour as aggressor_colour,
              dg.name as defender_name,  dg.colour as defender_colour
       FROM conflict.wars w
       JOIN social.groups ag ON ag.group_id = w.aggressor_group_id
       JOIN social.groups dg ON dg.group_id = w.defender_group_id
       WHERE w.world_id = $1 ${statusClause}
       ORDER BY w.declared_tick DESC`,
      params
    );
  });

  // Single war detail + skirmishes
  app.get('/wars/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const war = await queryOne<any>(
      `SELECT w.*,
              ag.name as aggressor_name, ag.colour as aggressor_colour,
              dg.name as defender_name,  dg.colour as defender_colour
       FROM conflict.wars w
       JOIN social.groups ag ON ag.group_id = w.aggressor_group_id
       JOIN social.groups dg ON dg.group_id = w.defender_group_id
       WHERE w.war_id = $1`,
      [id]
    );
    if (!war) return reply.code(404).send({ error: 'War not found' });

    const skirmishes = await query<any>(
      `SELECT s.*,
              at.name as attacker_name, dt.name as defender_name
       FROM conflict.skirmishes s
       JOIN agents.agents at ON at.agent_id = s.attacker_id
       JOIN agents.agents dt ON dt.agent_id = s.defender_id
       WHERE s.war_id = $1
       ORDER BY s.tick DESC
       LIMIT 50`,
      [id]
    );

    return { ...war, skirmishes };
  });

  // All skirmishes in a world (recent first)
  app.get('/worlds/:id/skirmishes', async (req) => {
    const { id } = req.params as { id: string };
    const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };
    return query<any>(
      `SELECT s.*,
              at.name as attacker_name, dt.name as defender_name,
              ag.name as attacker_group_name, dg.name as defender_group_name
       FROM conflict.skirmishes s
       JOIN agents.agents at ON at.agent_id = s.attacker_id
       JOIN agents.agents dt ON dt.agent_id = s.defender_id
       LEFT JOIN social.groups ag ON ag.group_id = s.attacker_group_id
       LEFT JOIN social.groups dg ON dg.group_id = s.defender_group_id
       WHERE s.world_id = $1
       ORDER BY s.tick DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), parseInt(offset)]
    );
  });

  // Active treaties in a world
  app.get('/worlds/:id/treaties', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT t.*,
              ga.name as group_a_name, ga.colour as group_a_colour,
              gb.name as group_b_name, gb.colour as group_b_colour
       FROM conflict.treaties t
       JOIN social.groups ga ON ga.group_id = t.group_a_id
       JOIN social.groups gb ON gb.group_id = t.group_b_id
       WHERE t.world_id = $1 AND t.status = 'active'
       ORDER BY t.ratified_tick DESC`,
      [id]
    );
  });

  // ── Phase 5: Governance & Laws ─────────────────────────────────────────────

  // Laws for a group
  app.get('/groups/:id/laws', async (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: string };
    const params: any[] = [id];
    const statusClause = status ? `AND l.status = $2` : '';
    if (status) params.push(status);
    return query<any>(
      `SELECT l.*, a.name as proposed_by_name
       FROM civilisation.laws l
       LEFT JOIN agents.agents a ON a.agent_id = l.proposed_by
       WHERE l.group_id = $1 ${statusClause}
       ORDER BY l.proposed_tick DESC`,
      params
    );
  });

  // All active laws in a world
  app.get('/worlds/:id/laws', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT l.*, g.name as group_name, g.colour as group_colour,
              a.name as proposed_by_name
       FROM civilisation.laws l
       JOIN social.groups g ON g.group_id = l.group_id
       LEFT JOIN agents.agents a ON a.agent_id = l.proposed_by
       WHERE l.world_id = $1 AND l.status = 'active'
       ORDER BY l.enacted_tick DESC`,
      [id]
    );
  });

  // Law violations in a world (recent)
  app.get('/worlds/:id/violations', async (req) => {
    const { id } = req.params as { id: string };
    const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };
    return query<any>(
      `SELECT v.*, l.name as law_name, l.law_type,
              va.name as violator_name,
              ra.name as reporter_name
       FROM civilisation.law_violations v
       JOIN civilisation.laws l ON l.law_id = v.law_id
       JOIN agents.agents va ON va.agent_id = v.violator_id
       LEFT JOIN agents.agents ra ON ra.agent_id = v.reporter_id
       WHERE v.world_id = $1
       ORDER BY v.tick DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), parseInt(offset)]
    );
  });

  // ── Phase 5: Economy / Currency ────────────────────────────────────────────

  // Currencies in a world
  app.get('/worlds/:id/currencies', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT c.*, g.name as group_name
       FROM civilisation.currencies c
       LEFT JOIN social.groups g ON g.group_id = c.group_id
       WHERE c.world_id = $1
       ORDER BY c.created_tick ASC`,
      [id]
    );
  });

  // Agent wallet balances
  app.get('/agents/:id/wallets', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT w.balance, w.total_earned, w.total_spent,
              c.name as currency_name, c.symbol, c.world_id
       FROM civilisation.wallets w
       JOIN civilisation.currencies c ON c.currency_id = w.currency_id
       WHERE w.agent_id = $1`,
      [id]
    );
  });

  // ── Phase 5: Technology ────────────────────────────────────────────────────

  // All discovered technologies in a world
  app.get('/worlds/:id/technologies', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT t.*,
              da.name as discoverer_name,
              g.name as group_name
       FROM civilisation.technologies t
       LEFT JOIN agents.agents da ON da.agent_id = t.discoverer_id
       LEFT JOIN social.groups g ON g.group_id = t.discovered_by_group_id
       WHERE t.world_id = $1
       ORDER BY t.discovered_tick ASC`,
      [id]
    );
  });

  // Agent's known technologies
  app.get('/agents/:id/technologies', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT at.learned_tick, at.learned_from_agent_id,
              t.tech_id, t.name, t.category, t.description,
              la.name as learned_from_name
       FROM civilisation.agent_technologies at
       JOIN civilisation.technologies t ON t.tech_id = at.tech_id
       LEFT JOIN agents.agents la ON la.agent_id = at.learned_from_agent_id
       WHERE at.agent_id = $1
       ORDER BY at.learned_tick DESC`,
      [id]
    );
  });

  // ── Phase 5: Construction / Structures ─────────────────────────────────────

  // Structures in a world
  app.get('/worlds/:id/structures', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT s.*,
              ba.name as built_by_name,
              g.name as group_name, g.colour as group_colour
       FROM civilisation.structures s
       LEFT JOIN agents.agents ba ON ba.agent_id = s.built_by_id
       LEFT JOIN social.groups g ON g.group_id = s.group_id
       WHERE s.world_id = $1 AND s.status = 'intact'
       ORDER BY s.built_tick DESC`,
      [id]
    );
  });

  // ── Phase 5: Chronicle ─────────────────────────────────────────────────────

  // Historical chronicle entries for a world
  app.get('/worlds/:id/chronicles', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT chronicle_id, era_name, era_start_day, era_end_day,
              narrative, key_events, generated_tick, created_at
       FROM civilisation.chronicles
       WHERE world_id = $1
       ORDER BY era_start_day ASC`,
      [id]
    );
  });

  // Single chronicle entry
  app.get('/chronicles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const chronicle = await queryOne<any>(
      `SELECT * FROM civilisation.chronicles WHERE chronicle_id = $1`,
      [id]
    );
    if (!chronicle) return reply.code(404).send({ error: 'Chronicle not found' });
    return chronicle;
  });

  // ── Phase 6: Beliefs ──────────────────────────────────────────────────────

  // All belief systems in a world
  app.get('/worlds/:id/beliefs', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT b.*, fa.name as founder_name
       FROM culture.belief_systems b
       LEFT JOIN agents.agents fa ON fa.agent_id = b.founder_id
       WHERE b.world_id = $1
       ORDER BY b.adherent_count DESC`,
      [id]
    );
  });

  // Single belief system detail + adherents
  app.get('/beliefs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const belief = await queryOne<any>(
      `SELECT b.*, fa.name as founder_name
       FROM culture.belief_systems b
       LEFT JOIN agents.agents fa ON fa.agent_id = b.founder_id
       WHERE b.belief_id = $1`,
      [id]
    );
    if (!belief) return reply.code(404).send({ error: 'Belief not found' });

    const adherents = await query<any>(
      `SELECT ab.conviction, ab.adopted_tick, ab.adopted_day,
              a.agent_id, a.name, a.archetype,
              s.hp, s.mental_state
       FROM culture.agent_beliefs ab
       JOIN agents.agents a ON a.agent_id = ab.agent_id
       JOIN agents.agent_state s ON s.agent_id = ab.agent_id
       WHERE ab.belief_id = $1
       ORDER BY ab.conviction DESC`,
      [id]
    );

    const myths = await query<any>(
      `SELECT m.myth_id, m.title, m.narrative, m.spread_count,
              m.believability, m.created_tick, m.created_day,
              a.name as author_name
       FROM culture.myths m
       JOIN agents.agents a ON a.agent_id = m.author_id
       WHERE m.belief_id = $1
       ORDER BY m.spread_count DESC`,
      [id]
    );

    return { ...belief, adherents, myths };
  });

  // Agent's beliefs and conviction levels
  app.get('/agents/:id/beliefs', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT ab.conviction, ab.personal_interpretation, ab.adopted_tick, ab.adopted_day,
              b.belief_id, b.name, b.core_tenet, b.colour,
              ca.name as converted_from_name
       FROM culture.agent_beliefs ab
       JOIN culture.belief_systems b ON b.belief_id = ab.belief_id
       LEFT JOIN agents.agents ca ON ca.agent_id = ab.converted_from_agent_id
       WHERE ab.agent_id = $1
       ORDER BY ab.conviction DESC`,
      [id]
    );
  });

  // ── Phase 6: Myths ────────────────────────────────────────────────────────

  // All myths in a world
  app.get('/worlds/:id/myths', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT m.*,
              a.name as author_name,
              b.name as belief_name, b.colour as belief_colour
       FROM culture.myths m
       JOIN agents.agents a ON a.agent_id = m.author_id
       LEFT JOIN culture.belief_systems b ON b.belief_id = m.belief_id
       WHERE m.world_id = $1
       ORDER BY m.spread_count DESC, m.created_tick DESC`,
      [id]
    );
  });

  // Agent's known myths
  app.get('/agents/:id/myths', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT am.fidelity, am.local_version, am.learned_tick,
              m.myth_id, m.title, m.narrative, m.spread_count,
              la.name as learned_from_name
       FROM culture.agent_myths am
       JOIN culture.myths m ON m.myth_id = am.myth_id
       LEFT JOIN agents.agents la ON la.agent_id = am.learned_from_id
       WHERE am.agent_id = $1
       ORDER BY am.learned_tick DESC`,
      [id]
    );
  });

  // ── Phase 6: Sacred Sites ─────────────────────────────────────────────────

  // Sacred sites in a world
  app.get('/worlds/:id/sacred-sites', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT ss.*,
              b.name as belief_name, b.colour as belief_colour
       FROM culture.sacred_sites ss
       JOIN culture.belief_systems b ON b.belief_id = ss.belief_id
       WHERE ss.world_id = $1
       ORDER BY ss.visit_count DESC`,
      [id]
    );
  });

  // ── Phase 6: Rituals ─────────────────────────────────────────────────────

  // Rituals for a belief or group
  app.get('/worlds/:id/rituals', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT r.*,
              b.name as belief_name, b.colour as belief_colour,
              g.name as group_name
       FROM culture.rituals r
       JOIN culture.belief_systems b ON b.belief_id = r.belief_id
       LEFT JOIN social.groups g ON g.group_id = r.group_id
       WHERE r.world_id = $1
       ORDER BY r.times_performed DESC`,
      [id]
    );
  });

  // ── Phase 6: Observer / Analytics ────────────────────────────────────────

  // World timeline snapshots (for timeline scrubber)
  app.get('/worlds/:id/snapshots', async (req) => {
    const { id } = req.params as { id: string };
    const { limit = '100' } = req.query as { limit?: string };
    return query<any>(
      `SELECT snapshot_id, tick, day, time_of_day, agent_count,
              alive_agents, group_states, active_wars, created_at
       FROM observer.world_snapshots
       WHERE world_id = $1
       ORDER BY tick DESC
       LIMIT $2`,
      [id, parseInt(limit)]
    );
  });

  // Single snapshot
  app.get('/snapshots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = await queryOne<any>(
      `SELECT * FROM observer.world_snapshots WHERE snapshot_id = $1`,
      [id]
    );
    if (!snap) return reply.code(404).send({ error: 'Snapshot not found' });
    return snap;
  });

  // Heatmap data for a world (latest day by default)
  app.get('/worlds/:id/heatmap', async (req) => {
    const { id } = req.params as { id: string };
    const { day, type = 'population' } = req.query as { day?: string; type?: string };

    const latestDay = day
      ? parseInt(day)
      : (await queryOne<{ max_day: number }>(
          `SELECT MAX(day) as max_day FROM observer.heatmap_data WHERE world_id = $1`,
          [id]
        ))?.max_day ?? 0;

    const col = {
      population: 'population_ticks',
      extraction: 'extraction_count',
      conflict: 'skirmish_count',
      ritual: 'ritual_count',
    }[type] ?? 'population_ticks';

    return query<any>(
      `SELECT x, y, ${col} as value
       FROM observer.heatmap_data
       WHERE world_id = $1 AND day = $2 AND ${col} > 0`,
      [id, latestDay]
    );
  });

  // Agent biography (cached LLM narrative)
  app.get('/agents/:id/biography', async (req, reply) => {
    const { id } = req.params as { id: string };
    const bio = await queryOne<any>(
      `SELECT * FROM observer.agent_biographies
       WHERE agent_id = $1
       ORDER BY generated_tick DESC LIMIT 1`,
      [id]
    );
    if (!bio) return reply.code(404).send({ error: 'No biography generated yet' });
    return bio;
  });

  // ── Generations: Family Tree ──────────────────────────────────────────────

  // Family tree for an agent (up to 4 generations)
  app.get('/agents/:id/family', async (req) => {
    const { id } = req.params as { id: string };

    // Fetch all agents in the world of this agent for family resolution
    const agent = await queryOne<{ world_id: string }>(
      `SELECT world_id FROM agents.agents WHERE agent_id = $1`, [id]
    );
    if (!agent) return [];

    // Get all agents with parent info for this world
    const allAgents = await query<any>(
      `SELECT agent_id, name, archetype, generation, status,
              parent_agent_ids, birth_tick, death_tick
       FROM agents.agents
       WHERE world_id = $1
       ORDER BY generation ASC, birth_tick ASC`,
      [agent.world_id]
    );

    // Build ancestry subtree: ancestors of the target agent up to 3 levels
    const agentMap = new Map(allAgents.map((a: any) => [a.agent_id, a]));

    function buildAncestry(agentId: string, depth: number): any {
      const a = agentMap.get(agentId);
      if (!a) return null;
      return {
        agent_id: a.agent_id,
        name: a.name,
        archetype: a.archetype,
        generation: a.generation,
        status: a.status,
        parents: depth > 0
          ? (a.parent_agent_ids as string[])
              .map((pid: string) => buildAncestry(pid, depth - 1))
              .filter(Boolean)
          : [],
      };
    }

    function buildDescendants(agentId: string, depth: number): any {
      const a = agentMap.get(agentId);
      if (!a) return null;
      const children = allAgents.filter((x: any) =>
        (x.parent_agent_ids as string[]).includes(agentId)
      );
      return {
        agent_id: a.agent_id,
        name: a.name,
        archetype: a.archetype,
        generation: a.generation,
        status: a.status,
        children: depth > 0
          ? children
              .map((c: any) => buildDescendants(c.agent_id, depth - 1))
              .filter(Boolean)
          : [],
      };
    }

    const ancestry = buildAncestry(id, 3);
    const descendants = buildDescendants(id, 3);

    // Siblings (share at least one parent)
    const focal = agentMap.get(id);
    const siblings = focal?.parent_agent_ids?.length
      ? allAgents.filter((a: any) =>
          a.agent_id !== id &&
          (a.parent_agent_ids as string[]).some((pid: string) =>
            (focal.parent_agent_ids as string[]).includes(pid)
          )
        ).map((a: any) => ({ agent_id: a.agent_id, name: a.name, archetype: a.archetype, generation: a.generation, status: a.status }))
      : [];

    return { ancestry, descendants, siblings };
  });

  // Reproduction records for a world
  app.get('/worlds/:id/reproductions', async (req) => {
    const { id } = req.params as { id: string };
    const { limit = '20', offset = '0' } = req.query as { limit?: string; offset?: string };
    return query<any>(
      `SELECT rr.*,
              pa.name as parent_a_name, pb.name as parent_b_name,
              ca.name as child_name, ca.archetype as child_archetype
       FROM agents.reproduction_records rr
       JOIN agents.agents pa ON pa.agent_id = rr.parent_a_id
       JOIN agents.agents pb ON pb.agent_id = rr.parent_b_id
       JOIN agents.agents ca ON ca.agent_id = rr.child_id
       WHERE rr.world_id = $1
       ORDER BY rr.tick DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), parseInt(offset)]
    );
  });

  // Trait drift events for an agent
  app.get('/agents/:id/trait-drift', async (req) => {
    const { id } = req.params as { id: string };
    return query<any>(
      `SELECT * FROM agents.trait_drift_events
       WHERE agent_id = $1
       ORDER BY tick DESC
       LIMIT 30`,
      [id]
    );
  });
}
