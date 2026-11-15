// Helpers of the GraphQL tests: every field of a type (built from the schema, so a field added to the schema is also
// compared), the GraphQL ↔ v1 comparison and the HTTP calls.
import assert from 'node:assert/strict';
import { buildSchema, getNamedType, isObjectType } from 'graphql';
import { readFileSync } from 'node:fs';
import { renamer } from '../src/graphql/resolvers.ts';

const schema = buildSchema(readFileSync(new URL('../src/graphql/schema.graphql', import.meta.url), 'utf8'));

/** Selection of every field of a type that has no arguments, nested (`Site` is not entered: it computes). */
export function selectAll(typeName: string): string {
  const type = schema.getType(typeName);
  if (!isObjectType(type)) throw new Error(typeName);
  return Object.values(type.getFields())
    .filter((f) => f.args.length === 0)
    .map((f) => {
      const t = getNamedType(f.type);
      if (!isObjectType(t)) return f.name;
      return t.name === 'Site' ? null : `${f.name} { ${selectAll(t.name)} }`;
    })
    .filter(Boolean)
    .join(' ');
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * The GraphQL value carries exactly the v1 values: every v1 field is there with the same value; a field v1 leaves out is
 * null; the panel orientation and the verdicts are GraphQL enums (vertical_rotating, not_viable). `warnings` is compared apart (assertWarnings).
 */
export function assertSameAsV1(gql: Json, v1: Json, path = '$'): void {
  if (Array.isArray(v1)) {
    assert.ok(Array.isArray(gql), `${path}: se esperaba una lista`);
    assert.equal(gql.length, v1.length, `${path}: longitud`);
    v1.forEach((x, i) => assertSameAsV1((gql as Json[])[i], x, `${path}[${i}]`));
    return;
  }
  if (v1 !== null && typeof v1 === 'object') {
    assert.ok(gql !== null && typeof gql === 'object' && !Array.isArray(gql), `${path}: se esperaba un objeto`);
    const g = gql as Record<string, Json>;
    for (const k of Object.keys(v1)) {
      if (k === 'warnings') continue;
      assert.ok(k in g, `${path}.${k}: el campo de la v1 no está en la respuesta GraphQL`);
      assertSameAsV1(g[k], v1[k], `${path}.${k}`);
    }
    for (const k of Object.keys(g)) if (!(k in v1) && k !== 'warnings') assert.equal(g[k], null, `${path}.${k}: no está en la v1, debería ser null`);
    return;
  }
  const hyphenEnum = path.endsWith('.panel.orientation') || path.endsWith('.verdict'); // vertical-rotating, not-viable
  const expected = hyphenEnum && typeof v1 === 'string' ? v1.replace('-', '_') : v1;
  assert.strictEqual(gql, expected, path);
}

/** Warnings of GraphQL = those of v1 with the GraphQL argument names. */
export function assertWarnings(gql: Json, v1: { warnings?: { code: string; parameter?: string; message: string }[] }, route: string, prefix = ''): void {
  const rename = renamer(route, prefix);
  assert.deepEqual(gql, (v1.warnings ?? []).map((w) => ({ code: w.code, parameter: w.parameter === undefined ? null : rename(w.parameter), message: rename(w.message) })), `warnings de ${route}`);
}

export interface GqlResponse { status: number; headers: Headers; body: { data?: Record<string, Json>; errors?: { message: string; path?: (string | number)[]; extensions: { code: string } }[]; extensions?: Record<string, Json> } }

/** POST /graphql. */
export async function gqlPost(base: string, query: string, variables?: Record<string, unknown>): Promise<GqlResponse> {
  const res = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  return { status: res.status, headers: res.headers, body: await res.json() as GqlResponse['body'] };
}

/** GET of v1 (body as JSON). */
export async function v1Get<T = Json>(base: string, p: string): Promise<T> {
  const res = await fetch(base + p);
  assert.equal(res.status, 200, `${p}: ${res.status}`);
  return await res.json() as T;
}

/** POST /graphql that must answer without errors; returns `data`. */
export async function gqlData(base: string, query: string, variables?: Record<string, unknown>): Promise<Record<string, Json>> {
  const r = await gqlPost(base, query, variables);
  assert.equal(r.status, 200, JSON.stringify(r.body.errors));
  assert.equal(r.body.errors, undefined, JSON.stringify(r.body.errors));
  return r.body.data!;
}
