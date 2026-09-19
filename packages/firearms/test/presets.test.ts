import {
	type DocumentSchema,
	validateDocumentSchema,
} from "@verifyistic/templates";
import { describe, expect, it } from "vitest";
import {
	FIREARM_PRESETS,
	PRESET_KEYS,
	instantiatePreset,
} from "../src/presets.js";

describe("firearm presets (doc 11 §3-4)", () => {
	it("ships the four launch presets, each with a not-legal-advice disclaimer", () => {
		expect(PRESET_KEYS.sort()).toEqual([
			"minor_guardian_waiver",
			"range_liability_waiver",
			"range_rules_safety",
			"rental_firearm_agreement",
		]);
		for (const preset of Object.values(FIREARM_PRESETS)) {
			const paragraphs = preset.schema.blocks.filter(
				(b) => b.type === "paragraph",
			);
			const hasDisclaimer = paragraphs.some(
				(p) => p.type === "paragraph" && p.text.includes("not legal advice"),
			);
			expect(hasDisclaimer).toBe(true);
		}
	});

	it("every preset schema passes document-schema validation", () => {
		for (const preset of Object.values(FIREARM_PRESETS)) {
			const result = validateDocumentSchema(preset.schema as DocumentSchema);
			expect({ key: preset.key, ...result }).toEqual({
				key: preset.key,
				valid: true,
				errors: [],
			});
		}
	});

	it("minor/guardian preset has the guardian branch and DOB capture (doc 07 §7)", () => {
		const minor = FIREARM_PRESETS.minor_guardian_waiver!;
		expect(minor.guardianPolicy).toMatchObject({
			min_age: 18,
			require_guardian_for_minors: true,
		});
		expect(
			minor.schema.blocks.some(
				(b) => b.type === "participant" && b.role === "guardian",
			),
		).toBe(true);
		expect(
			minor.schema.blocks.some(
				(b) => b.type === "field" && b.field_type === "dob",
			),
		).toBe(true);
	});

	it("conditional rental block references a defined checkbox field", () => {
		const waiver = FIREARM_PRESETS.range_liability_waiver!;
		const result = validateDocumentSchema(waiver.schema as DocumentSchema);
		expect(result.valid).toBe(true);
	});

	it("instantiatePreset returns undefined for unknown keys and honors name overrides", () => {
		expect(instantiatePreset("nope")).toBeUndefined();
		const inst = instantiatePreset(
			"range_liability_waiver",
			"My Range Waiver",
		)!;
		expect(inst.name).toBe("My Range Waiver");
		expect(inst.title).toBe("Range Liability Waiver");
		expect(inst.schema).toEqual(FIREARM_PRESETS.range_liability_waiver!.schema);
	});
});
