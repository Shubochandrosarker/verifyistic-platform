/**
 * Server-side field extraction and validation from a published template schema (doc 07 §8).
 * The signer never decides which fields are required — the server walks the schema,
 * evaluates conditionals from submitted values, and records exactly which conditional
 * sections were shown (evidence snapshot requirement).
 */
import type { DocumentSchema, TemplateBlock } from "@verifyistic/templates";

export interface RequiredFieldSpec {
	field_key: string;
	field_type: string;
	label: string;
	required: boolean;
	/** Path of the conditional block that made this field conditionally required. */
	conditionalOf?: string;
	options?: string[];
	/** True for signature blocks — enforced via the signatures[] submission, not form values. */
	isSignature?: boolean;
}

export interface ConditionalDecision {
	field_key: string;
	expected: unknown;
	shown: boolean;
}

export interface WalkResult {
	required: RequiredFieldSpec[];
	/** Every conditional in the schema with whether it was shown given the submitted values. */
	conditionals: ConditionalDecision[];
}

function flatten(
	blocks: TemplateBlock[],
	parentConditional: string | undefined,
	out: RequiredFieldSpec[],
	conditionals: { field: string; expected: unknown }[],
): void {
	for (const block of blocks) {
		if (block.type === "field") {
			out.push({
				field_key: block.field_key,
				field_type: block.field_type,
				label: block.label,
				required: block.required === true,
				conditionalOf: parentConditional,
				options: block.options,
			});
		} else if (block.type === "initials" || block.type === "signature") {
			out.push({
				field_key: block.field_key,
				field_type: block.type,
				label: block.label,
				required: block.required === true || block.type === "signature",
				conditionalOf: parentConditional,
				// Signature blocks are satisfied via the signatures[] submission, not form values.
				isSignature: block.type === "signature",
			});
		} else if (block.type === "conditional") {
			conditionals.push({ field: block.if.field, expected: block.if.equals });
			flatten(block.blocks, block.if.field, out, conditionals);
		}
	}
}

export function walkSchema(
	schema: DocumentSchema,
	submittedValues: Record<string, unknown>,
): WalkResult {
	const required: RequiredFieldSpec[] = [];
	const conditionals: { field: string; expected: unknown }[] = [];
	flatten(schema.blocks, undefined, required, conditionals);

	const decisions: ConditionalDecision[] = conditionals.map((c) => ({
		field_key: c.field,
		expected: c.expected,
		shown: submittedValues[c.field] === c.expected,
	}));
	const shownKeys = new Set(
		decisions.filter((d) => d.shown).map((d) => d.field_key),
	);

	// A field inside a shown conditional (or at top level) is required per its own flag.
	const effective = required.filter(
		(spec) =>
			spec.conditionalOf === undefined || shownKeys.has(spec.conditionalOf),
	);
	return { required: effective, conditionals: decisions };
}

export interface FieldValidationResult {
	valid: boolean;
	errors: Record<string, string[]>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-\s.]{7,20}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate submitted values against the schema walk for a session. */
export function validateSubmittedFields(
	schema: DocumentSchema,
	values: Record<string, unknown>,
): { decisions: ConditionalDecision[]; result: FieldValidationResult } {
	const { required, conditionals } = walkSchema(schema, values);
	const decisions = conditionals;
	const errors: Record<string, string[]> = {};

	for (const spec of required) {
		// Signature blocks are enforced by the signatures[] submission in the service.
		if (spec.isSignature) continue;
		const value = values[spec.field_key];
		const missing =
			value === undefined || value === null || value === "" || value === false;
		if (missing) {
			if (spec.required) errors[spec.field_key] = ["This field is required."];
			continue;
		}
		switch (spec.field_type) {
			case "email":
				if (typeof value !== "string" || !EMAIL_RE.test(value))
					errors[spec.field_key] = ["Enter a valid email address."];
				break;
			case "phone":
				if (typeof value !== "string" || !PHONE_RE.test(value))
					errors[spec.field_key] = ["Enter a valid phone number."];
				break;
			case "dob":
				if (typeof value !== "string" || !DOB_RE.test(value))
					errors[spec.field_key] = ["Enter date of birth as YYYY-MM-DD."];
				break;
			case "radio":
			case "select":
				if (!spec.options?.includes(String(value)))
					errors[spec.field_key] = ["Choose one of the listed options."];
				break;
			default:
				if (
					typeof value !== "string" &&
					typeof value !== "boolean" &&
					typeof value !== "number"
				) {
					errors[spec.field_key] = ["Unsupported value type."];
				}
				if (typeof value === "string" && value.length > 5000) {
					errors[spec.field_key] = ["Value too long."];
				}
		}
	}
	return {
		decisions,
		result: { valid: Object.keys(errors).length === 0, errors },
	};
}
