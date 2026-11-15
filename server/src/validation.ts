import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import configSchema from '../../schema/config.schema.json' with { type: 'json' };
import missionSchema from '../../schema/mission.schema.json' with { type: 'json' };
import personaSchema from '../../schema/persona.schema.json' with { type: 'json' };

export type SchemaKind = 'config' | 'persona' | 'mission';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});

const validators: Record<SchemaKind, ValidateFunction> = {
  config: ajv.compile(configSchema),
  persona: ajv.compile(personaSchema),
  mission: ajv.compile(missionSchema),
};

export function validate(kind: SchemaKind, data: unknown): ValidationResult {
  const validator = validators[kind];

  if (validator(data)) {
    return { valid: true, issues: [] };
  }

  return { valid: false, issues: describe(validator.errors ?? []) };
}

function describe(errors: ErrorObject[]): ValidationIssue[] {
  const meaningful = errors.filter((error) => !['if', 'oneOf', 'anyOf'].includes(error.keyword));
  const seen = new Set<string>();

  return (meaningful.length > 0 ? meaningful : errors)
    .map((error) => ({ path: error.instancePath || '/', message: messageFor(error) }))
    .filter((issue) => {
      const key = `${issue.path} ${issue.message}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function messageFor(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;

  if (error.keyword === 'additionalProperties') {
    return `unknown field "${String(params['additionalProperty'])}"`;
  }

  if (error.keyword === 'required') {
    return `missing required field "${String(params['missingProperty'])}"`;
  }

  if (error.keyword === 'enum') {
    const allowed = (params['allowedValues'] as unknown[]).map(String).join(', ');
    return `must be one of: ${allowed}`;
  }

  return error.message ?? 'is invalid';
}
