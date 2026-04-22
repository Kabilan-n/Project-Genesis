'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

interface FamilyNode {
  agent_id: string;
  name: string;
  archetype: string;
  generation: number;
  status: 'alive' | 'dead' | 'archived';
  parents?: FamilyNode[];
  children?: FamilyNode[];
}

interface FamilyData {
  ancestry: FamilyNode | null;
  descendants: FamilyNode | null;
  siblings: FamilyNode[];
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function StatusDot({ status }: { status: string }) {
  return (
    <span className={clsx(
      'w-1.5 h-1.5 rounded-full inline-block mr-1',
      status === 'alive' ? 'bg-green-400' : status === 'dead' ? 'bg-red-500' : 'bg-gray-500'
    )} />
  );
}

function NodeCard({
  node,
  onSelect,
  highlight = false,
}: {
  node: FamilyNode;
  onSelect?: (id: string) => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect?.(node.agent_id)}
      className={clsx(
        'rounded px-2 py-1.5 text-left transition-colors min-w-[80px]',
        highlight
          ? 'bg-blue-900/60 border border-blue-500/50 text-white'
          : 'bg-gray-800/60 border border-gray-700/40 text-gray-300 hover:bg-gray-700/50'
      )}
    >
      <div className="text-xs font-medium flex items-center">
        <StatusDot status={node.status} />
        {node.name}
      </div>
      <div className="text-xs text-gray-500 truncate">{node.archetype}</div>
      <div className="text-xs text-gray-600">Gen {node.generation}</div>
    </button>
  );
}

function AncestryTree({ node, depth = 0, onSelect }: { node: FamilyNode; depth?: number; onSelect?: (id: string) => void }) {
  if (depth > 2) return null;
  const parents = node.parents ?? [];
  return (
    <div className="flex flex-col items-center gap-1">
      {parents.length > 0 && (
        <div className="flex gap-4 items-end">
          {parents.map(p => (
            <AncestryTree key={p.agent_id} node={p} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
      {parents.length > 0 && (
        <div className="w-px h-3 bg-gray-600" />
      )}
      <NodeCard node={node} onSelect={onSelect} highlight={depth === 0} />
    </div>
  );
}

function DescendantTree({ node, depth = 0, onSelect }: { node: FamilyNode; depth?: number; onSelect?: (id: string) => void }) {
  if (depth > 2) return null;
  const children = node.children ?? [];
  return (
    <div className="flex flex-col items-center gap-1">
      <NodeCard node={node} onSelect={onSelect} highlight={depth === 0} />
      {children.length > 0 && (
        <>
          <div className="w-px h-3 bg-gray-600" />
          <div className="flex gap-4 items-start">
            {children.map(c => (
              <DescendantTree key={c.agent_id} node={c} depth={depth + 1} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function FamilyTree({
  agentId,
  onSelectAgent,
}: {
  agentId: string;
  onSelectAgent?: (id: string) => void;
}) {
  const [data, setData] = useState<FamilyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'ancestry' | 'descendants'>('ancestry');

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/agents/${agentId}/family`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <div className="text-gray-500 text-xs p-2">Loading family tree...</div>;
  if (!data) return <div className="text-gray-500 text-xs p-2">No family data</div>;

  const hasAncestry = !!data.ancestry?.parents?.length;
  const hasDescendants = !!data.descendants?.children?.length;
  const hasSiblings = data.siblings.length > 0;

  if (!hasAncestry && !hasDescendants && !hasSiblings) {
    return (
      <div className="text-gray-500 text-xs p-2 text-center">
        No known family connections
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* View toggle */}
      <div className="flex gap-1 bg-gray-800/60 rounded p-0.5">
        {(['ancestry', 'descendants'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              'flex-1 rounded py-0.5 text-xs capitalize transition-colors',
              view === v ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Ancestry view */}
      {view === 'ancestry' && (
        <div className="overflow-x-auto">
          {hasAncestry && data.ancestry ? (
            <div className="min-w-max flex justify-center py-2">
              <AncestryTree node={data.ancestry} onSelect={onSelectAgent} />
            </div>
          ) : (
            <div className="text-gray-500 text-center py-4">No known ancestors</div>
          )}

          {hasSiblings && (
            <div className="mt-3">
              <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Siblings</div>
              <div className="flex gap-1 flex-wrap">
                {data.siblings.map(s => (
                  <NodeCard key={s.agent_id} node={s} onSelect={onSelectAgent} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Descendants view */}
      {view === 'descendants' && (
        <div className="overflow-x-auto">
          {hasDescendants && data.descendants ? (
            <div className="min-w-max flex justify-center py-2">
              <DescendantTree node={data.descendants} onSelect={onSelectAgent} />
            </div>
          ) : (
            <div className="text-gray-500 text-center py-4">No known descendants</div>
          )}
        </div>
      )}
    </div>
  );
}
