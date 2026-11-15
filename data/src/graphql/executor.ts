// Runs GraphQL requests: preparation (parse, validation, limits) and execution. The preparation runs in the main thread
// before queueing (a query over a limit never takes a worker) and again in the worker, which then executes it: every
// resolver is synchronous (the engine is), so a request is one task of the pool, like a v1 request.
import { readFileSync } from 'node:fs';
import {
  GraphQLError, NoSchemaIntrospectionCustomRule, buildSchema, executeSync, getOperationAST, getVariableValues, parse, specifiedRules, validate,
} from 'graphql';
import type { DocumentNode, OperationDefinitionNode } from 'graphql';
import { withVectorCache, vectorCacheStats } from '../../../backend/src/ephemeris.ts';
import { GraphQLContext, root } from './resolvers.ts';
import { analyze, graphqlConfig, requestError } from './limits.ts';
import type { Analysis, GraphQLConfig } from './limits.ts';
import { spanish } from './messages.ts';

/** The schema as published in /graphql/schema.graphql. */
export const SDL = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
export const schema = buildSchema(SDL);

/** A GraphQL request (GraphQL over HTTP): the query, its variables and the operation to run. */
export interface GraphQLRequest { query?: unknown; variables?: unknown; operationName?: unknown; extensions?: unknown }

/** Error in the response: Spanish message, position in the query, path of the field and code. */
export interface FormattedError { message: string; locations?: readonly { line: number; column: number }[]; path?: readonly (string | number)[]; extensions: { code: string } }

export type Preparation =
  | { ok: true; document: DocumentNode; operation: OperationDefinitionNode; variables: Record<string, unknown>; analysis: Analysis }
  | { ok: false; errors: FormattedError[] };

const fail = (errors: readonly GraphQLError[], code: string): Preparation => ({ ok: false, errors: errors.map((e) => format(e, code)) });

/** Parses, validates and analyses a request without running it. */
export function prepareRequest(req: GraphQLRequest, cfg: GraphQLConfig = graphqlConfig()): Preparation {
  const { query, variables, operationName } = req;
  if (typeof query !== 'string' || query.trim() === '') {
    return fail([requestError('Falta la consulta: pásala en `query` (en la URL con GET o en el cuerpo JSON con POST).', 'bad_request')], 'bad_request');
  }
  if (variables !== undefined && variables !== null && (typeof variables !== 'object' || Array.isArray(variables))) {
    return fail([requestError('`variables` debe ser un objeto JSON.', 'bad_request')], 'bad_request');
  }
  if (operationName !== undefined && operationName !== null && typeof operationName !== 'string') {
    return fail([requestError('`operationName` debe ser un texto.', 'bad_request')], 'bad_request');
  }
  let document: DocumentNode;
  try {
    document = parse(query, { maxTokens: cfg.maxTokens });
  } catch (e) {
    const err = e as GraphQLError;
    return fail([err], /tokens/.test(err.message) ? 'query_too_large' : 'syntax_error');
  }
  const rules = cfg.introspection ? specifiedRules : [...specifiedRules, NoSchemaIntrospectionCustomRule];
  const invalid = validate(schema, document, rules, { maxErrors: 20 });
  if (invalid.length) return fail(invalid, 'validation_failed');
  const operation = getOperationAST(document, operationName ?? undefined);
  if (!operation) {
    return fail([requestError(operationName ? `No hay ninguna operación llamada «${operationName}».` : 'La consulta tiene varias operaciones: indica operationName.', 'validation_failed')], 'validation_failed');
  }
  const vars = (variables ?? {}) as Record<string, unknown>;
  const coerced = getVariableValues(schema, operation.variableDefinitions ?? [], vars, { maxErrors: 20 });
  if ('errors' in coerced && coerced.errors) return fail(coerced.errors, 'invalid_variables');
  try {
    const analysis = analyze(schema, document, operation, (coerced as { variableValues: Parameters<typeof analyze>[3] }).variableValues, cfg);
    return { ok: true, document, operation, variables: vars, analysis };
  } catch (e) {
    if (e instanceof GraphQLError) return fail([e], 'invalid_parameter');
    throw e;
  }
}

/** A GraphQLError as the response carries it: Spanish message and a code (internal errors are not shown). */
function format(e: GraphQLError, fallbackCode: string): FormattedError {
  let code = e.extensions?.code as string | undefined;
  let message = e.message;
  if (!code) {
    const original = e.originalError;
    if (original && !(original instanceof GraphQLError)) {
      console.error(original);
      code = 'internal_error';
      message = 'Error interno del servidor';
    } else {
      code = fallbackCode;
      message = spanish(e.message);
    }
  }
  return { message, ...(e.locations ? { locations: e.locations } : {}), ...(e.path ? { path: e.path } : {}), extensions: { code } };
}

/** Response of an executed request: HTTP status, GraphQL body and whether it can be cached (no errors). */
export interface Executed { status: number; body: { data?: unknown; errors?: FormattedError[]; extensions?: unknown }; cacheable: boolean }

/**
 * Prepares and runs a request. `extensions` of the response: estimated cost and limits, and what the request computed
 * (v1 route calls, calls answered by the per-request memo, ephemeris samples computed and reused).
 */
export function executeRequest(req: GraphQLRequest, cfg: GraphQLConfig = graphqlConfig()): Executed {
  const p = prepareRequest(req, cfg);
  if (!p.ok) return { status: 400, body: { errors: p.errors }, cacheable: false };
  const ctx = new GraphQLContext();
  const before = vectorCacheStats();
  const result = withVectorCache(() => executeSync({
    schema, document: p.document, rootValue: root, contextValue: ctx, variableValues: p.variables, operationName: (req.operationName as string | null) ?? undefined,
  }));
  const after = vectorCacheStats();
  const errors = result.errors?.map((e) => format(e, 'invalid_parameter'));
  return {
    status: 200,
    body: {
      ...(errors?.length ? { errors } : {}),
      data: result.data ?? null,
      extensions: {
        cost: { estimated: p.analysis.cost, limit: cfg.maxCost, depth: p.analysis.depth, siteDates: p.analysis.siteDates },
        computed: { routeCalls: ctx.counters.routeCalls, memoHits: ctx.counters.memoHits, ephemerisSamples: after.misses - before.misses, ephemerisReused: after.hits - before.hits },
      },
    },
    cacheable: !errors?.length,
  };
}
