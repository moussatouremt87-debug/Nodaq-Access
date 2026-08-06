---
name: Orval inline request body type conflict
description: Inline POST bodies generate type aliases that conflict with Zod const exports in api-zod barrel
---

When an OpenAPI POST endpoint has an **inline** request body (not a `$ref` to a named component schema), Orval generates both:
1. A Zod schema `const FooBody = zod.object({...})` in `lib/api-zod/src/generated/api.ts`
2. A TypeScript `type FooBody = {...}` in `lib/api-zod/src/generated/types/fooBody.ts`

TypeScript 5.x disallows re-exporting both from the same barrel index — even with `export type *`.

**Why:** Named component schemas generate `interface` (value+interface can coexist), but inline bodies generate `type` aliases (value+type cannot coexist in the same namespace).

**How to apply:**
- Prefer named `$ref` schemas for all request bodies → they generate interfaces, no conflict
- If a dedicated action endpoint (e.g. `/echeances/{id}/payer`) would create an inline-body conflict, fold the action into the existing PATCH endpoint (`status: "PAYEE"`) instead
- Never use `export type *` as a workaround — TypeScript 5.9 still rejects it for value/type name clashes
