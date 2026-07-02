// Tiny typed schema layer. Two jobs:
//   1. Emit a JSON Schema the server can consume via `response_format:
//      json_schema` (OpenAI spec, mlx_lm.server / vLLM / LM Studio all accept
//      this shape).
//   2. Validate/coerce raw JSON produced by the model at runtime.
//
// Not a Zod replacement — deliberately small. Objects, strings, numbers,
// booleans, string enums, arrays, and required-field markers cover every
// intelligence contract we'll write for internal tasks (titles, classifiers,
// structured extracts). If we ever need unions/refinements, add Zod then.

export type SchemaNode =
  | { kind: 'string'; description?: string; minLength?: number; maxLength?: number }
  | { kind: 'number'; description?: string; min?: number; max?: number; integer?: boolean }
  | { kind: 'boolean'; description?: string }
  | { kind: 'enum'; values: readonly string[]; description?: string }
  | { kind: 'array'; item: SchemaNode; description?: string; minItems?: number; maxItems?: number }
  | {
      kind: 'object'
      properties: Record<string, SchemaNode>
      required: readonly string[]
      description?: string
    }

// Type-level projection: SchemaNode → TypeScript type. Lets contracts declare
// `outputShape: SchemaNode` and get a typed result on `runContract`.
export type Infer<T extends SchemaNode> =
  T extends { kind: 'string' } ? string
    : T extends { kind: 'number' } ? number
    : T extends { kind: 'boolean' } ? boolean
    : T extends { kind: 'enum'; values: readonly (infer V)[] } ? V
    : T extends { kind: 'array'; item: infer I extends SchemaNode } ? Infer<I>[]
    : T extends { kind: 'object'; properties: infer P } ?
        { [K in keyof P]: P[K] extends SchemaNode ? Infer<P[K]> : never }
    : never

// Narrow-preserving builders. Each helper returns a discriminated node type
// so `Infer<ReturnType<typeof s.string>>` narrows to `string`, not the full
// union. This is what makes `contract.finalize(parsed, input)` type-check
// with `parsed: string` instead of `parsed: string | number | ...`.
type StringNode = Extract<SchemaNode, { kind: 'string' }>
type NumberNode = Extract<SchemaNode, { kind: 'number' }>
type BooleanNode = Extract<SchemaNode, { kind: 'boolean' }>
type EnumNode<V extends string> = { kind: 'enum'; values: readonly V[]; description?: string }
type ArrayNode<I extends SchemaNode> = { kind: 'array'; item: I; description?: string; minItems?: number; maxItems?: number }
type ObjectNode<P extends Record<string, SchemaNode>> = {
  kind: 'object'
  properties: P
  required: readonly string[]
  description?: string
}

export const s = {
  string: (opts: Omit<StringNode, 'kind'> = {}): StringNode => ({ kind: 'string', ...opts }),
  number: (opts: Omit<NumberNode, 'kind'> = {}): NumberNode => ({ kind: 'number', ...opts }),
  boolean: (opts: Omit<BooleanNode, 'kind'> = {}): BooleanNode => ({ kind: 'boolean', ...opts }),
  enum: <V extends string>(values: readonly V[], description?: string): EnumNode<V> =>
    ({ kind: 'enum', values, ...(description ? { description } : {}) }),
  array: <I extends SchemaNode>(item: I, opts: Omit<ArrayNode<I>, 'kind' | 'item'> = {}): ArrayNode<I> =>
    ({ kind: 'array', item, ...opts }),
  object: <P extends Record<string, SchemaNode>>(
    properties: P,
    opts: { required?: readonly string[]; description?: string } = {},
  ): ObjectNode<P> => {
    // Default: every declared property is required. Cheaper prompt guidance —
    // if the model can skip fields, it will.
    const required = opts.required ?? Object.keys(properties)
    return {
      kind: 'object',
      properties,
      required,
      ...(opts.description ? { description: opts.description } : {}),
    }
  },
}

export function toJsonSchemaBlock(node: SchemaNode): Record<string, unknown> {
  switch (node.kind) {
    case 'string': {
      const out: Record<string, unknown> = { type: 'string' }
      if (node.description) out.description = node.description
      if (node.minLength != null) out.minLength = node.minLength
      if (node.maxLength != null) out.maxLength = node.maxLength
      return out
    }
    case 'number': {
      const out: Record<string, unknown> = { type: node.integer ? 'integer' : 'number' }
      if (node.description) out.description = node.description
      if (node.min != null) out.minimum = node.min
      if (node.max != null) out.maximum = node.max
      return out
    }
    case 'boolean': {
      const out: Record<string, unknown> = { type: 'boolean' }
      if (node.description) out.description = node.description
      return out
    }
    case 'enum': {
      const out: Record<string, unknown> = { type: 'string', enum: [...node.values] }
      if (node.description) out.description = node.description
      return out
    }
    case 'array': {
      const out: Record<string, unknown> = {
        type: 'array',
        items: toJsonSchemaBlock(node.item),
      }
      if (node.description) out.description = node.description
      if (node.minItems != null) out.minItems = node.minItems
      if (node.maxItems != null) out.maxItems = node.maxItems
      return out
    }
    case 'object': {
      const properties: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node.properties)) {
        properties[k] = toJsonSchemaBlock(v)
      }
      const out: Record<string, unknown> = {
        type: 'object',
        properties,
        required: [...node.required],
        additionalProperties: false,
      }
      if (node.description) out.description = node.description
      return out
    }
  }
}

export interface ValidationSuccess<T> {
  ok: true
  value: T
}

export interface ValidationFailure {
  ok: false
  errors: string[]
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

export function validateBlock<T extends SchemaNode>(
  node: T,
  raw: unknown,
  path = '$',
): ValidationResult<Infer<T>> {
  const errors: string[] = []
  const value = coerce(node, raw, path, errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: value as Infer<T> }
}

function coerce(node: SchemaNode, raw: unknown, path: string, errors: string[]): unknown {
  switch (node.kind) {
    case 'string':
      if (typeof raw !== 'string') {
        errors.push(`${path}: expected string, got ${typeof raw}`)
        return ''
      }
      return raw
    case 'number':
      if (typeof raw !== 'number' || Number.isNaN(raw)) {
        // Accept string numerics — models often quote numbers.
        if (typeof raw === 'string' && raw.trim() && !Number.isNaN(Number(raw))) {
          return node.integer ? Math.trunc(Number(raw)) : Number(raw)
        }
        errors.push(`${path}: expected number, got ${typeof raw}`)
        return 0
      }
      return node.integer ? Math.trunc(raw) : raw
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      errors.push(`${path}: expected boolean, got ${typeof raw}`)
      return false
    case 'enum':
      if (typeof raw === 'string' && node.values.includes(raw as never)) return raw
      errors.push(`${path}: expected one of ${node.values.join('|')}, got ${JSON.stringify(raw)}`)
      return node.values[0]
    case 'array':
      if (!Array.isArray(raw)) {
        errors.push(`${path}: expected array, got ${typeof raw}`)
        return []
      }
      return raw.map((el, i) => coerce(node.item, el, `${path}[${i}]`, errors))
    case 'object': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${path}: expected object, got ${Array.isArray(raw) ? 'array' : typeof raw}`)
        return {}
      }
      const record = raw as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [k, sub] of Object.entries(node.properties)) {
        const present = k in record
        if (!present) {
          if (node.required.includes(k)) {
            errors.push(`${path}.${k}: missing required field`)
          }
          continue
        }
        out[k] = coerce(sub, record[k], `${path}.${k}`, errors)
      }
      return out
    }
  }
}
