---
name: Drizzle tx.execute() returns QueryResult, not row array
description: tx.execute(sql`...`) returns a pg.QueryResult object (with .rows), never a plain array — array destructuring will throw "not iterable" at runtime.
---

## Rule
`tx.execute(sql\`...\`)` on a Drizzle NodePgTransaction calls the node-postgres `client.query()` path
(the `!fields && !customResultMapper` branch in `NodePgPreparedQuery.execute()`), which returns the
raw `QueryResult` object — NOT the rows array.

**Wrong:**
```typescript
const [res] = await tx.execute(sql`SELECT ...`) as unknown as [{ n: number }];
// → TypeError: (intermediate value) is not iterable
```

**Right — use the execRows helper:**
```typescript
function execRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
const [res] = execRows<{ n: number }>(await tx.execute(sql`SELECT ...`));
// → res = { n: 42 }
```

**Why:** Drizzle source `node-postgres/session.js` line ~117: the raw-SQL execute path returns
`await client.query(rawQuery, params)` directly (a `QueryResult`). The `.rows` unwrapping only
happens for the `PreparedQuery.all()` method (line ~144), not for `execute()`.

**How to apply:** Every `tx.execute(sql\`...\`)` call in analytics calculators (and any future
raw-SQL code inside a withTenant transaction) must go through `execRows<T>()` to get a usable array.
The `db.execute()` at the module level behaves the same way.

**Evidence from Drizzle internals:**
```javascript
// NodePgSession.count() in session.js confirms:
async count(sql2) {
  const res = await this.execute(sql2);
  return Number(res["rows"][0]["count"]); // accesses .rows explicitly
}
```
