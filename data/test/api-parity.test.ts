// REST v1 ↔ GraphQL: what one offers, the other offers (#71). The table of data/src/graphql/operations.ts (from which
// the resolvers build their v1 calls) is checked against data/openapi.yaml and schema.graphql in both directions:
// every v1 route, parameter and response field has its GraphQL equivalent, and every GraphQL argument and field of an
// operation has its v1 one. The only exceptions are V1_ONLY and GRAPHQL_ONLY, each with its reason. That the same
// question gives the same answer by both paths is in single-source.test.ts.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { getNamedType, getNullableType, isEnumType, isInputObjectType, isListType, isObjectType } from 'graphql';
import type { GraphQLArgument, GraphQLField, GraphQLInputField, GraphQLInputType, GraphQLOutputType } from 'graphql';
import { schema } from '../src/graphql/executor.ts';
import { GRAPHQL_ONLY, OPERATIONS, SITE_ARGS, V1_ONLY } from '../src/graphql/operations.ts';
import { routes } from '../src/v1.ts';
import { ROUTE_PARAMS } from '../src/request.ts';
import type { Schema } from './schema.ts';

interface Param { $ref?: string; name: string }
interface Op { parameters?: Param[]; responses: Record<string, { content?: Record<string, { schema: Schema }> }> }
const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Op>>; components: { parameters: Record<string, Param>; schemas: Record<string, Schema> };
};
const deref = <T>(x: T & { $ref?: string }): T => (x.$ref ? deref(x.$ref.slice(2).split('/').reduce((o: any, k) => o[k], spec) as T & { $ref?: string }) : x); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every route of openapi.yaml as `METHOD path`. */
const v1Routes = Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
const paramsOf = (route: string): string[] => (spec.paths[route].get.parameters ?? []).map((p) => deref(p).name);

/** `Type.field` of the schema. */
function fieldOf(coordinate: string): GraphQLField<unknown, unknown> | undefined {
  const [type, name] = coordinate.split('.');
  const t = schema.getType(type);
  return isObjectType(t) ? t.getFields()[name] : undefined;
}

/** Type of an argument path (`terrain.observerHeightM`) of a field; undefined when it does not exist. */
function argType(field: GraphQLField<unknown, unknown>, path: string): GraphQLInputType | undefined {
  const [first, ...rest] = path.split('.');
  let type: GraphQLInputType | undefined = field.args.find((a) => a.name === first)?.type;
  for (const k of rest) {
    const named = type && getNamedType(type);
    type = isInputObjectType(named) ? named.getFields()[k]?.type : undefined;
  }
  return type;
}

/** Every argument path of a field, input objects included (`terrain`, `terrain.observerHeightM`…), with the input type that holds it. */
function argPaths(args: readonly (GraphQLArgument | GraphQLInputField)[], prefix = '', holder = ''): { path: string; holder: string }[] {
  return args.flatMap((a) => {
    const path = prefix + a.name;
    const named = getNamedType(a.type);
    return [{ path, holder: holder ? `${holder}.${a.name}` : '' }, ...(isInputObjectType(named) ? argPaths(Object.values(named.getFields()), `${path}.`, named.name) : [])];
  });
}

/** Problems found, in Spanish: the test fails listing all of them. */
const report = (problems: string[], what: string): void => assert.deepEqual(problems, [], `${what}:\n  - ${problems.join('\n  - ')}`);

describe('paridad de lo que ofrecen la v1 y GraphQL (data/src/graphql/operations.ts)', () => {
  test('cada ruta de la v1 tiene su campo de GraphQL (o es una excepción con motivo)', () => {
    const problems: string[] = [];
    for (const r of v1Routes) {
      const path = r.slice(r.indexOf(' ') + 1);
      if (V1_ONLY[r]) continue;
      if (!r.startsWith('GET ')) problems.push(`${r}: ruta de la v1 sin equivalente en GraphQL (añádela a OPERATIONS o, con motivo, a V1_ONLY)`);
      else if (!OPERATIONS[path]) problems.push(`${path}: ruta de la v1 sin equivalente en GraphQL (añádela a OPERATIONS en data/src/graphql/operations.ts)`);
    }
    for (const route of Object.keys(OPERATIONS)) {
      if (!spec.paths[route]?.get) problems.push(`${route}: está en OPERATIONS pero no en openapi.yaml`);
      if (!routes[route]) problems.push(`${route}: está en OPERATIONS pero no en las rutas de src/v1.ts`);
      if (!fieldOf(OPERATIONS[route].field)) problems.push(`${route}: el campo ${OPERATIONS[route].field} no existe en schema.graphql`);
    }
    for (const route of Object.keys(routes)) if (!OPERATIONS[route]) problems.push(`${route}: ruta de src/v1.ts sin operación de GraphQL`);
    for (const key of Object.keys(V1_ONLY)) {
      if (/^[A-Z]+ /.test(key) && !v1Routes.includes(key)) problems.push(`V1_ONLY tiene ${key}, que ya no existe en openapi.yaml: quítala`);
    }
    report(problems, 'Rutas de la v1 y campos de GraphQL que no se corresponden');
  });

  test('cada parámetro de la v1 tiene su argumento de GraphQL, y al revés', () => {
    const problems: string[] = [];
    const siteField = fieldOf('Query.site')!;
    for (const [route, op] of Object.entries(OPERATIONS)) {
      const field = fieldOf(op.field);
      if (!field) continue; // reported above
      const v1 = new Set(paramsOf(route));
      const documented = new Set(ROUTE_PARAMS[route] ?? []);
      for (const p of v1) if (!documented.has(p)) problems.push(`${route}?${p}: está en openapi.yaml pero no en ROUTE_PARAMS (src/request.ts)`);
      const mapped = new Set([...Object.keys(op.params), ...(op.site ? Object.keys(SITE_ARGS) : [])]);
      for (const p of v1) {
        if (!mapped.has(p) && !V1_ONLY[`${route}?${p}`]) problems.push(`${route}?${p}: parámetro de la v1 sin argumento en ${op.field} (añádelo a OPERATIONS y a schema.graphql)`);
      }
      for (const p of mapped) if (!v1.has(p)) problems.push(`${route}?${p}: está en OPERATIONS pero la v1 no tiene ese parámetro`);
      for (const [p, s] of Object.entries(op.params)) {
        if (!argType(field, s.arg)) problems.push(`${route}?${p}: OPERATIONS lo lleva a ${op.field}(${s.arg}), que no existe en schema.graphql`);
      }
      if (op.site) {
        if (fieldOf(op.field)?.name && !op.field.startsWith('Site.')) problems.push(`${route}: con site: true el campo debe ser de Site`);
        for (const a of Object.values(SITE_ARGS)) if (!siteField.args.some((x) => x.name === a)) problems.push(`Query.site no tiene el argumento ${a}`);
      }
      // Al revés: cada argumento de GraphQL de la operación sale de un parámetro de la v1.
      const covered = new Set<string>();
      for (const s of Object.values(op.params)) {
        covered.add(s.arg);
        if (s.to === 'switch') { const obj = s.arg.replace(/\.enabled$/, ''); covered.add(obj); covered.add(`${obj}.enabled`); }
      }
      for (const { path, holder } of argPaths(field.args)) {
        const named = getNamedType(argType(field, path)!);
        if (isInputObjectType(named) && !covered.has(path)) continue; // an input object: its fields are checked one by one
        if (covered.has(path) || GRAPHQL_ONLY[`${op.field}(${path})`] || (holder && GRAPHQL_ONLY[holder])) continue;
        problems.push(`${op.field}(${path}): argumento de GraphQL sin parámetro en ${route} (añádelo a la v1 y a OPERATIONS, o con motivo a GRAPHQL_ONLY)`);
      }
    }
    // compare usa el mismo barrido que Site.landingDates: sus argumentos, iguales.
    const ld = fieldOf('Site.landingDates')!;
    const input = schema.getType('LandingDatesInput');
    assert.ok(isInputObjectType(input));
    const sig = (xs: readonly { name: string; type: unknown }[]): string[] => xs.map((x) => `${x.name}: ${String(x.type)}`).sort();
    assert.deepEqual(sig(Object.values(input.getFields())), sig(ld.args), 'LandingDatesInput (compare) debe tener los mismos argumentos que Site.landingDates');
    report(problems, 'Parámetros de la v1 y argumentos de GraphQL que no se corresponden');
  });

  test('cada campo de Query y cada cálculo de Site sale de una ruta de la v1 (o es una excepción con motivo)', () => {
    const mapped = new Set(Object.values(OPERATIONS).map((o) => o.field));
    const problems: string[] = [];
    for (const f of Object.values(schema.getQueryType()!.getFields())) {
      const c = `Query.${f.name}`;
      if (!mapped.has(c) && !GRAPHQL_ONLY[c]) problems.push(`${c}: campo de GraphQL sin ruta de la v1`);
    }
    const site = schema.getType('Site');
    assert.ok(isObjectType(site));
    for (const f of Object.values(site.getFields())) {
      const c = `Site.${f.name}`;
      if (f.args.length && !mapped.has(c) && !GRAPHQL_ONLY[c]) problems.push(`${c}: cálculo de GraphQL sin ruta de la v1`);
    }
    for (const key of Object.keys(GRAPHQL_ONLY)) {
      const [type, rest] = key.split('.');
      const name = rest.replace(/\(.*$/, '');
      const t = schema.getType(type);
      const exists = isObjectType(t) || isInputObjectType(t) ? Boolean(t.getFields()[name]) : false;
      if (!exists) problems.push(`GRAPHQL_ONLY tiene ${key}, que ya no existe en schema.graphql: quítala`);
    }
    report(problems, 'Campos de GraphQL sin equivalente en la v1');
  });

  test('cada campo de respuesta de la v1 se puede pedir en GraphQL, con todos sus valores de enum, y al revés', () => {
    const problems: string[] = [];
    const isAllowed = (route: string, path: string, gqlType: string, name: string): boolean =>
      Boolean(V1_ONLY[`${route}#${path}`] || V1_ONLY[`${gqlType}.${name}`]);
    const enumValues = (xs: readonly unknown[]): string[] => xs.filter((x) => typeof x === 'string' && x !== '').map((x) => (x as string).replace(/-/g, '_')).sort();

    const compare = (route: string, v1: Schema, gql: GraphQLOutputType, path: string): void => {
      const s = deref(v1);
      const type = getNullableType(gql);
      if (s.type === 'array' || (Array.isArray(s.type) && s.type.includes('array'))) {
        if (!isListType(type)) { problems.push(`${route}#${path}: en la v1 es una lista y en GraphQL no`); return; }
        if (s.items) compare(route, s.items, type.ofType, `${path}[]`);
        return;
      }
      const named = getNamedType(type);
      if (s.properties) {
        if (!isObjectType(named)) { problems.push(`${route}#${path}: en la v1 es un objeto y en GraphQL es ${String(named)}`); return; }
        const fields = named.getFields();
        for (const [k, sub] of Object.entries(s.properties)) {
          const p = path ? `${path}.${k}` : k;
          if (!fields[k]) {
            if (!isAllowed(route, p, named.name, k)) problems.push(`${route}#${p}: campo de la v1 que no se puede pedir en GraphQL (${named.name}.${k})`);
            continue;
          }
          compare(route, sub, fields[k].type, p);
        }
        for (const f of Object.values(fields)) {
          if (f.args.length || s.properties[f.name] || GRAPHQL_ONLY[`${named.name}.${f.name}`]) continue;
          problems.push(`${named.name}.${f.name} (${route}#${path || '.'}): campo de GraphQL que la v1 no da`);
        }
        return;
      }
      // Every value v1 can answer must exist in the GraphQL enum (which may have more: the same enum is also an input).
      if (s.enum && isEnumType(named)) {
        const b = enumValues(named.getValues().map((v) => v.value));
        const missing = enumValues(s.enum).filter((v) => !b.includes(v));
        if (missing.length) problems.push(`${route}#${path}: valores de la v1 que no tiene el enum ${named.name} de GraphQL: ${missing.join(', ')}`);
      }
    };

    for (const [route, op] of Object.entries(OPERATIONS)) {
      const field = fieldOf(op.field);
      const body = deref(spec.paths[route]?.get?.responses['200'].content!['application/json'].schema as Schema);
      if (!field || !body) continue;
      if (op.list) {
        for (const k of Object.keys(body.properties!)) {
          if (k !== op.list && !V1_ONLY[`${route}#${k}`]) problems.push(`${route}#${k}: campo de la v1 que GraphQL no da (${op.field} devuelve solo la lista ${op.list})`);
        }
        compare(route, body.properties![op.list], field.type, op.list);
      } else compare(route, body, field.type, '');
    }
    report(problems, 'Campos de respuesta de la v1 y de GraphQL que no se corresponden');
  });
});
