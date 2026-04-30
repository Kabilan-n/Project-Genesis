# Test Conventions — `@genesis/simulation`

These conventions exist so every engine's test file looks the same and so
new tests can be added without re-deriving the pattern. They were
formalised during Phase 2 of the stabilization effort.

## File layout

- One test file per engine, named `<EngineName>.test.ts`.
- Sit in `packages/simulation/src/__tests__/`.
- Shared fixtures live in `fixtures.ts`. Add a fixture there before
  duplicating object construction across files.

## Structure

Outer-to-inner: `describe(EngineName)` → `describe(method)` → `it(condition)`.

```ts
describe('FooEngine.computeBar', () => {
  it('returns 0 when input is empty', () => { ... });
  it('clamps to MAX_BAR', () => { ... });
});
```

## Exposing private methods

Use a sub-class to access private methods without changing visibility on the
production class:

```ts
class TestableFooEngine extends FooEngine {
  computeBarPublic(...args: Parameters<FooEngine['computeBar']>) {
    return (this as any).computeBar(...args);
  }
}
```

This keeps the public API of the engine clean while letting tests reach
pure-function helpers. Keep these helpers small and side-effect-free so
they're worth testing in isolation.

## I/O is mocked

No test in this directory should connect to Postgres, Redis, the LLM, or
any HTTP service. Use `vi.fn()` for every external dependency. If an engine
makes mocking awkward, refactor the engine to take its dependencies via
constructor (see `MemoryDecay` for the pattern).

Integration tests that need real services live under
`packages/simulation/src/__tests__/integration/` and run via
`npm run test:integration` (Phase 2 task 2.14).

## Fixtures

Use the `make<Type>` factories from `fixtures.ts`. Every factory takes a
`Partial<...>` overrides argument so tests can express only the field that
matters:

```ts
const agent = makeAgent({ state: makeState({ hp: 5 }) });
```

If you find yourself repeating object construction across two tests, add
a factory.

## What to test

For each engine, cover at minimum:

- Each public method's happy path.
- Each documented state transition (with explicit start and end states).
- Boundary conditions (off-by-one, empty input, null input).
- Each branch in conditional logic that affects the return value.

Do **not** test database SQL strings, query parameter ordering, or
implementation details that would need to change if the SQL was rewritten.
Test behavior, not transcripts.

## Running

```sh
npm test                    # all tests, single run
npm run test:watch          # watch mode
npm run test:coverage       # with coverage report
```
