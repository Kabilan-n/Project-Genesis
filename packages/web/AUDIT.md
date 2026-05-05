# Web — async UI audit (Phase 5 / task 5.2)

Inventory of every component that fetches data from the API. Each row
captures whether it currently renders explicit `loading`, `error`, and
`empty` states, and whether it's been migrated to the shared
`useAsyncData` + `AsyncStates` primitives.

| Component | apiFetch / fetch | loading | error | empty | useAsyncData? |
|-----------|:----:|:----:|:----:|:----:|:----:|
| `app/viewer/page.tsx`   | yes (4 endpoints) | yes (spinner) | partial (red text) | partial | no |
| `components/AgentProfile.tsx`     | yes (5 parallel) | implicit | no  | partial | no |
| `components/BeliefPanel.tsx`      | yes (2 parallel) | no  | no  | partial | no |
| `components/ChatThreadModal.tsx`  | yes              | implicit | no  | yes | no |
| `components/ChroniclePanel.tsx`   | yes              | yes (spinner) | yes (retry) | yes | yes ✓ |
| `components/CivilisationPanel.tsx`| yes              | partial | no  | partial | no |
| `components/ConversationHistory.tsx` | yes           | implicit | no  | yes | no |
| `components/EventFeed.tsx`        | derived from store, no fetch | n/a | n/a | yes | n/a |
| `components/FamilyTree.tsx`       | yes              | no  | no  | yes | no |
| `components/LawPanel.tsx`         | yes              | partial | no  | yes | no |
| `components/WarPanel.tsx`         | yes              | partial | no  | yes | no |
| `components/SettingsModal.tsx`    | yes              | partial | no  | n/a | no |

## Pattern

Every component using `useAsyncData` should render the four states
explicitly:

```tsx
const { data, loading, error, isEmpty, refetch } = useAsyncData(
  (signal) => apiFetch('/foo', { signal }).then(r => r.json()),
  [worldId],
  { isEmpty: (rows: Row[]) => rows.length === 0 },
);

if (loading) return <LoadingSpinner label="Loading foo…" />;
if (error)   return <InlineError error={error} onRetry={refetch} />;
if (isEmpty) return <EmptyState label="No foo yet." />;
return <ActualContent data={data!} />;
```

`ChroniclePanel` is the worked reference. Retrofit the rest
incrementally — track in this file as "useAsyncData? yes ✓".
