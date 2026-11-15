// Spanish messages for the errors graphql-js produces in English (syntax, validation, variables). The most common
// ones are translated; anything else keeps the original text after a Spanish lead-in. The code goes in extensions.code.

const q = (s: string): string => `«${s}»`;
/** «Did you mean "a", "b", or "c"?» → «¿Querías decir «a», «b» o «c»?» */
const didYouMean = (s: string): string => s.replace(/ Did you mean (?:the enum value |to use an inline fragment on )?(.+)\?$/, (_m, list: string) =>
  ` ¿Querías decir ${list.replace(/"([^"]+)"/g, '«$1»').replace(/,? or /, ' o ')}?`);

const RULES: [RegExp, (...m: string[]) => string][] = [
  [/^Syntax Error: Expected (.+), found (.+)\.$/, (_, a, b) => `Error de sintaxis: se esperaba ${a} y se encontró ${b}.`],
  [/^Syntax Error: Unexpected (.+)\.$/, (_, a) => `Error de sintaxis: ${a} inesperado.`],
  [/^Syntax Error: Unterminated string\.$/, () => 'Error de sintaxis: falta cerrar una cadena.'],
  [/^Syntax Error: (.+)$/, (_, a) => `Error de sintaxis: ${a}`],
  [/^Document contains more than (\d+) tokens\. Parsing aborted\.$/, (_, n) => `La consulta es demasiado larga: más de ${n} elementos (LUNAR_GRAPHQL_MAX_TOKENS).`],
  [/^Cannot query field "([^"]+)" on type "([^"]+)"\.(.*)$/, (_, f, t, rest) => `El campo ${q(f)} no existe en el tipo ${t}.${didYouMean(rest)}`],
  [/^Unknown argument "([^"]+)" on field "([^"]+)"\.(.*)$/, (_, a, f, rest) => `El argumento ${q(a)} no existe en el campo ${f}.${didYouMean(rest)}`],
  [/^Field "([^"]+)" argument "([^"]+)" of type "([^"]+)" is required, but (?:it was )?not provided\.$/, (_, f, a, t) => `Falta el argumento obligatorio ${q(a)} (${t}) del campo ${f}.`],
  [/^Argument "([^"(]+)\(([^:")]+):\)" of type "([^"]+)" is required, but it was not provided\.$/, (_, f, a, t) => `Falta el argumento obligatorio ${q(a)} (${t}) del campo ${f}.`],
  [/^Argument "([^"]+)" of required type "([^"]+)" was not provided\.$/, (_, a, t) => `Falta el argumento obligatorio ${q(a)} (${t}).`],
  [/^Field "([^"]+)" of type "([^"]+)" must have a selection of subfields\.(.*)$/, (_, f, t) => `El campo ${q(f)} (${t}) necesita una selección de subcampos: ${f} { … }.`],
  [/^Field "([^"]+)" must not have a selection since type "([^"]+)" has no subfields\.$/, (_, f, t) => `El campo ${q(f)} no admite subcampos: su tipo ${t} es un valor simple.`],
  [/^Variable "\$([^"]+)" of required type "([^"]+)" was not provided\.$/, (_, v, t) => `Falta la variable obligatoria $${v} (${t}).`],
  [/^Variable "\$([^"]+)" of non-null type "([^"]+)" must not be null\.$/, (_, v, t) => `La variable $${v} (${t}) no puede ser null.`],
  [/^Variable "\$([^"]+)" got invalid value (.+)$/, (_, v, rest) => `La variable $${v} tiene un valor no válido: ${rest}`],
  [/^Variable "\$([^"]+)" is never used(?: in operation "([^"]+)")?\.$/, (_, v) => `La variable $${v} no se usa.`],
  [/^Variable "\$([^"]+)" is not defined(?: by operation "([^"]+)")?\.$/, (_, v) => `La variable $${v} no está declarada en la operación.`],
  [/^Value "([^"]+)" does not exist in "([^"]+)" enum\.(.*)$/, (_, v, e, rest) => `El valor ${q(v)} no existe en ${e}.${didYouMean(rest)}`],
  [/^Enum "([^"]+)" cannot represent non-enum value: (.+?)\.(.*)$/, (_, e, v, rest) => `${e} no admite el valor ${v}: usa uno de sus valores sin comillas.${didYouMean(rest)}`],
  [/^(Int|Float|String|Boolean|ID) cannot represent (?:a )?(?:non[- ][\w ]+|non-integer) value: (.+)$/, (_, t, v) => `Valor no válido para ${t}: ${v}`],
  [/^Expected value of type "([^"]+)", found (.+?)(?:; (.+))?$/, (_, t, v, why) => `Se esperaba un valor de tipo ${t} y se encontró ${v}${why ? `: ${why}` : '.'}`],
  [/^Unknown type "([^"]+)"\.(.*)$/, (_, t, rest) => `El tipo ${q(t)} no existe.${didYouMean(rest)}`],
  [/^Unknown fragment "([^"]+)"\.$/, (_, f) => `El fragmento ${q(f)} no existe.`],
  [/^Fragment "([^"]+)" is never used\.$/, (_, f) => `El fragmento ${q(f)} no se usa.`],
  [/^Unknown operation named "([^"]+)"\.$/, (_, o) => `No hay ninguna operación llamada ${q(o)}.`],
  [/^Must provide operation name if query contains multiple operations\.$/, () => 'La consulta tiene varias operaciones: indica operationName.'],
  [/^Must provide an operation\.$/, () => 'La consulta no tiene ninguna operación.'],
  [/^Field "([^"]+)" is not defined by type "([^"]+)"\.(.*)$/, (_, f, t, rest) => `El campo ${q(f)} no existe en el input ${t}.${didYouMean(rest)}`],
  [/^Field "([^"]+)" of required type "([^"]+)" was not provided\.$/, (_, f, t) => `Falta el campo obligatorio ${q(f)} (${t}).`],
  [/^There can be only one (.+)\.$/, (_, what) => `Repetido: solo puede haber un(a) ${what}.`],
  [/^Fields "([^"]+)" conflict because (.+)$/, (_, f, why) => `Los campos ${q(f)} chocan (${why}); usa alias distintos.`],
  [/^GraphQL introspection has been disabled.*$/, () => 'La introspección está desactivada en este servidor (LUNAR_GRAPHQL_INTROSPECTION=0).'],
];

/** Spanish version of a graphql-js message. */
export function spanish(message: string): string {
  for (const [re, f] of RULES) {
    const m = re.exec(message);
    if (m) return f(...m);
  }
  return `Consulta no válida: ${message}`;
}
