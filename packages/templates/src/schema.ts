/**
 * Structured block schema (doc 19 §4): validated, versioned, rendered consistently.
 * Drafts validate at publish time; a published version's schema is frozen (source_hash).
 */
export type TemplateFieldType =
	| "text"
	| "email"
	| "phone"
	| "dob"
	| "checkbox"
	| "radio"
	| "select";

export interface FieldBlock {
	type: "field";
	field_key: string;
	label: string;
	field_type: TemplateFieldType;
	required?: boolean;
	/** For radio/select. */
	options?: string[];
}

export interface HeadingBlock {
	type: "heading";
	text: string;
}

export interface ParagraphBlock {
	type: "paragraph";
	text: string;
}

export interface InitialsBlock {
	type: "initials";
	field_key: string;
	label: string;
	required?: boolean;
}

export interface ConditionalBlock {
	type: "conditional";
	/** Show the nested blocks only when field equals value (doc 07 §8). */
	if: { field: string; equals: unknown };
	blocks: TemplateBlock[];
}

export interface ParticipantBlock {
	type: "participant";
	role: "signer" | "guardian" | "witness";
}

export interface SignatureBlock {
	type: "signature";
	field_key: string;
	label: string;
}

export type TemplateBlock =
	| HeadingBlock
	| ParagraphBlock
	| FieldBlock
	| InitialsBlock
	| ConditionalBlock
	| ParticipantBlock
	| SignatureBlock;

export interface DocumentSchema {
	blocks: TemplateBlock[];
}

export interface SchemaValidationResult {
	valid: boolean;
	errors: string[];
}

const FIELD_TYPES: readonly TemplateFieldType[] = [
	"text",
	"email",
	"phone",
	"dob",
	"checkbox",
	"radio",
	"select",
];

const BLOCK_TYPES = new Set([
	"heading",
	"paragraph",
	"field",
	"initials",
	"conditional",
	"participant",
	"signature",
]);

/** Validate one block; returns error strings (empty = valid). Recurses into conditional blocks. */
function validateBlock(
	block: unknown,
	path: string,
	fieldKeys: Set<string>,
	errors: string[],
): void {
	if (typeof block !== "object" || block === null) {
		errors.push(`${path}: block must be an object`);
		return;
	}
	const b = block as Record<string, unknown>;
	if (typeof b.type !== "string" || !BLOCK_TYPES.has(b.type)) {
		errors.push(`${path}: unknown block type ${JSON.stringify(b.type)}`);
		return;
	}

	switch (b.type) {
		case "heading":
		case "paragraph":
			if (typeof b.text !== "string" || b.text.trim().length === 0) {
				errors.push(`${path}: text is required`);
			}
			break;
		case "field": {
			if (typeof b.field_key !== "string" || b.field_key.length === 0) {
				errors.push(`${path}: field_key is required`);
			} else {
				fieldKeys.add(b.field_key);
			}
			if (typeof b.label !== "string" || b.label.trim().length === 0) {
				errors.push(`${path}: label is required`);
			}
			if (
				typeof b.field_type !== "string" ||
				!FIELD_TYPES.includes(b.field_type as TemplateFieldType)
			) {
				errors.push(
					`${path}: field_type must be one of ${FIELD_TYPES.join(", ")}`,
				);
			}
			if (
				(b.field_type === "radio" || b.field_type === "select") &&
				!Array.isArray(b.options)
			) {
				errors.push(`${path}: radio/select blocks require options`);
			}
			break;
		}
		case "initials":
		case "signature":
			if (typeof b.field_key !== "string" || b.field_key.length === 0) {
				errors.push(`${path}: field_key is required`);
			} else {
				fieldKeys.add(b.field_key);
			}
			if (typeof b.label !== "string" || b.label.trim().length === 0) {
				errors.push(`${path}: label is required`);
			}
			break;
		case "conditional": {
			const cond = b.if as Record<string, unknown> | undefined;
			if (!cond || typeof cond.field !== "string" || cond.field.length === 0) {
				errors.push(`${path}: if.field is required`);
			}
			if (!Array.isArray(b.blocks)) {
				errors.push(`${path}: blocks array is required`);
			} else if (b.blocks.length === 0) {
				errors.push(`${path}: conditional block is empty`);
			} else {
				b.blocks.forEach((nested, index) =>
					validateBlock(nested, `${path}.blocks[${index}]`, fieldKeys, errors),
				);
			}
			break;
		}
		case "participant":
			if (
				b.role !== "signer" &&
				b.role !== "guardian" &&
				b.role !== "witness"
			) {
				errors.push(`${path}: role must be signer, guardian, or witness`);
			}
			break;
	}
}

/** All field_keys referenced by conditionals must exist somewhere in the schema. */
function validateConditionalReferences(
	schema: DocumentSchema,
	errors: string[],
): void {
	const defined = new Set<string>();
	const referenced: { field: string; path: string }[] = [];

	const walk = (blocks: TemplateBlock[], path: string): void => {
		for (const [index, block] of blocks.entries()) {
			const blockPath = `${path}.blocks[${index}]`;
			if (
				block.type === "field" ||
				block.type === "initials" ||
				block.type === "signature"
			) {
				defined.add(block.field_key);
			}
			if (block.type === "conditional") {
				referenced.push({ field: block.if.field, path: blockPath });
				walk(block.blocks, blockPath);
			}
		}
	};
	walk(schema.blocks, "$");

	for (const ref of referenced) {
		if (!defined.has(ref.field)) {
			errors.push(
				`${ref.path}: conditional references unknown field "${ref.field}"`,
			);
		}
	}
}

export function validateDocumentSchema(
	schema: unknown,
): SchemaValidationResult {
	const errors: string[] = [];
	if (
		typeof schema !== "object" ||
		schema === null ||
		!Array.isArray((schema as DocumentSchema).blocks)
	) {
		return {
			valid: false,
			errors: ["$ : schema must be an object with a blocks array"],
		};
	}
	const doc = schema as DocumentSchema;
	if (doc.blocks.length === 0) {
		errors.push("$.blocks: schema must contain at least one block");
	}
	const fieldKeys = new Set<string>();
	doc.blocks.forEach((block, index) =>
		validateBlock(block, `$.blocks[${index}]`, fieldKeys, errors),
	);
	validateConditionalReferences(doc, errors);
	return { valid: errors.length === 0, errors };
}
