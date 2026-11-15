// Minimal validator for the JSON Schema (2020-12) subset that openapi.yaml uses.
// Supports: local $ref (with siblings, as OpenAPI 3.1 allows), type (or list of types), const, enum,
// required, properties, additionalProperties: false, items, minimum, maximum and format: date-time.
// Any other keyword fails validation: that way a schema we believe is checked but is not cannot slip through.

/** A JSON Schema node of openapi.yaml (unknown keywords are kept so validate() can reject them). */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  format?: string;
  [keyword: string]: unknown;
}

/** Media type of a response: its schema and its example(s). */
export interface MediaType { schema: Schema; example?: unknown; examples?: Record<string, { value: unknown }> }
export interface OpenApiResponse { $ref?: string; content: Record<string, MediaType> }
/** The parts of openapi.yaml the tests read. */
export interface OpenApiSpec {
  openapi: string;
  paths: Record<string, { get?: { responses?: Record<string, OpenApiResponse> } }>;
  components: { schemas: Record<string, Schema>; responses?: Record<string, OpenApiResponse> };
}

const KNOWN = new Set([
  '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items',
  'minimum', 'maximum', 'format', 'description', 'examples', 'default',
]);

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const matchesType = (v: unknown, t: string): boolean => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);

function resolve(spec: unknown, ref: string): Schema {
  if (!ref.startsWith('#/')) throw new Error(`Solo se admiten $ref locales: ${ref}`);
  return ref.slice(2).split('/').reduce((node: unknown, key) => {
    if (!node || typeof node !== 'object' || !(key in node)) throw new Error(`$ref no resuelto: ${ref}`);
    return (node as Record<string, unknown>)[key];
  }, spec) as Schema;
}

/** Returns the list of errors (empty if `value` satisfies `schema`). */
export function validate(spec: unknown, schema: Schema, value: unknown, path: string = '$'): string[] {
  const errors: string[] = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) errors.push(`${path}: palabra clave no soportada por el validador: ${k}`);
  if (schema.$ref) {
    const { $ref, ...rest } = schema;
    errors.push(...validate(spec, resolve(spec, $ref), value, path));
    if (Object.keys(rest).length) errors.push(...validate(spec, rest, value, path));
    return errors;
  }
  if (schema.type) {
    const types = ([] as string[]).concat(schema.type);
    if (!types.some((t) => matchesType(value, t))) return [...errors, `${path}: se esperaba ${types.join('|')} y llegó ${typeOf(value)} (${JSON.stringify(value)})`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: debe valer ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} no está en ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (schema.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) errors.push(`${path}: fecha inválida ${value}`);
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in object)) errors.push(`${path}: falta el campo obligatorio ${k}`);
    for (const [k, v] of Object.entries(object)) {
      const sub = schema.properties?.[k];
      if (sub) errors.push(...validate(spec, sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: campo no documentado ${k}`);
    }
  }
  const items = schema.items;
  if (Array.isArray(value) && items) value.forEach((v, i) => errors.push(...validate(spec, items, v, `${path}[${i}]`)));
  return errors;
}
