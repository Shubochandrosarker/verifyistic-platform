/**
 * Firearm-range preset templates (doc 11 §3-4). Every preset is an editable starting
 * point — Verifyistic supplies the structure; the business (or its counsel) supplies
 * and reviews the legal text. No universal compliance claims (doc 11 §1).
 */
import type { DocumentSchema } from "@verifyistic/templates";

export interface FirearmPreset {
	key: string;
	name: string;
	category: string;
	defaultValidityDays: number;
	guardianPolicy: Record<string, unknown>;
	schema: DocumentSchema;
}

const disclaimer: { type: "paragraph"; text: string } = {
	type: "paragraph",
	text: "This template is an editable starting point provided by Verifyistic. It is not legal advice. Have your agreement language and retention requirements reviewed for your jurisdiction.",
};

const emergencyContactField = {
	type: "field" as const,
	field_key: "emergency_contact",
	label: "Emergency contact (name & phone)",
	field_type: "text" as const,
	required: true,
};

export const FIREARM_PRESETS: Record<string, FirearmPreset> = {
	range_liability_waiver: {
		key: "range_liability_waiver",
		name: "Range Liability Waiver",
		category: "range_waiver",
		defaultValidityDays: 365,
		guardianPolicy: { min_age: 18, require_guardian_for_minors: true },
		schema: {
			blocks: [
				{
					type: "heading",
					text: "Range Liability Waiver & Assumption of Risk",
				},
				disclaimer,
				{
					type: "paragraph",
					text: "[Business legal text — assumption of risk, release of claims, indemnification goes here.]",
				},
				{
					type: "field",
					field_key: "legal_name",
					label: "Full legal name",
					field_type: "text",
					required: true,
				},
				{
					type: "field",
					field_key: "date_of_birth",
					label: "Date of birth",
					field_type: "dob",
					required: true,
				},
				{
					type: "field",
					field_key: "phone",
					label: "Phone",
					field_type: "phone",
					required: true,
				},
				emergencyContactField,
				{
					type: "field",
					field_key: "is_renting_firearm",
					label: "Will you rent a firearm today?",
					field_type: "checkbox",
				},
				{
					type: "conditional",
					if: { field: "is_renting_firearm", equals: true },
					blocks: [
						{
							type: "paragraph",
							text: "[Rental terms: damage/loss responsibility, safe-use confirmation.]",
						},
						{
							type: "initials",
							field_key: "rental_acknowledgment",
							label: "Initial: rental terms acknowledgment",
							required: true,
						},
					],
				},
				{
					type: "initials",
					field_key: "safety_rules_ack",
					label:
						"Initial: I have read and will follow all range safety rules and staff commands",
					required: true,
				},
				{
					type: "initials",
					field_key: "eye_ear_protection",
					label:
						"Initial: eye and ear protection worn at all times on the firing line",
					required: true,
				},
				{
					type: "field",
					field_key: "media_release",
					label: "Optional: I consent to photo/media capture",
					field_type: "checkbox",
				},
				{ type: "signature", field_key: "signature", label: "Signature" },
			],
		},
	},

	range_rules_safety: {
		key: "range_rules_safety",
		name: "Range Rules & Safety Acknowledgment",
		category: "range_waiver",
		defaultValidityDays: 365,
		guardianPolicy: { min_age: 18, require_guardian_for_minors: true },
		schema: {
			blocks: [
				{ type: "heading", text: "Range Rules & Safety Acknowledgment" },
				disclaimer,
				{
					type: "paragraph",
					text: "[The four primary firearm-safety rules, posted range commands, and cease-fire procedures.]",
				},
				{
					type: "field",
					field_key: "legal_name",
					label: "Full legal name",
					field_type: "text",
					required: true,
				},
				{
					type: "initials",
					field_key: "rule_muzzle",
					label: "Initial: muzzle always pointed in a safe direction",
					required: true,
				},
				{
					type: "initials",
					field_key: "rule_finger",
					label: "Initial: finger off trigger until ready to fire",
					required: true,
				},
				{
					type: "initials",
					field_key: "rule_loaded",
					label: "Initial: treat every firearm as if it were loaded",
					required: true,
				},
				{
					type: "initials",
					field_key: "rule_target",
					label: "Initial: be sure of your target and what is beyond it",
					required: true,
				},
				{
					type: "initials",
					field_key: "staff_command",
					label: "Initial: I will immediately obey any staff command",
					required: true,
				},
				{
					type: "field",
					field_key: "impairment_ack",
					label:
						"I affirm I am not under the influence of alcohol or impairing substances",
					field_type: "checkbox",
					required: true,
				},
				{ type: "signature", field_key: "signature", label: "Signature" },
			],
		},
	},

	rental_firearm_agreement: {
		key: "rental_firearm_agreement",
		name: "Rental Firearm Agreement",
		category: "rental",
		defaultValidityDays: 30,
		guardianPolicy: { min_age: 21, require_guardian_for_minors: false },
		schema: {
			blocks: [
				{ type: "heading", text: "Rental Firearm Agreement" },
				disclaimer,
				{
					type: "paragraph",
					text: "[Rental terms: identification held, damage/loss responsibility, safe-use confirmation, return condition.]",
				},
				{
					type: "field",
					field_key: "legal_name",
					label: "Full legal name",
					field_type: "text",
					required: true,
				},
				{
					type: "field",
					field_key: "date_of_birth",
					label: "Date of birth (21+ for handgun rental)",
					field_type: "dob",
					required: true,
				},
				{
					type: "field",
					field_key: "experience_level",
					label: "Experience level",
					field_type: "select",
					options: ["first-time shooter", "some experience", "experienced"],
					required: true,
				},
				{
					type: "field",
					field_key: "training_ack",
					label: "I have received a safety briefing on the rented firearm",
					field_type: "checkbox",
					required: true,
				},
				{
					type: "initials",
					field_key: "damage_responsibility",
					label:
						"Initial: I accept responsibility for damage or loss of rental equipment",
					required: true,
				},
				{ type: "signature", field_key: "signature", label: "Signature" },
			],
		},
	},

	minor_guardian_waiver: {
		key: "minor_guardian_waiver",
		name: "Minor/Guardian Waiver",
		category: "minor",
		defaultValidityDays: 365,
		guardianPolicy: { min_age: 18, require_guardian_for_minors: true },
		schema: {
			blocks: [
				{
					type: "heading",
					text: "Minor Participation Waiver (Guardian Consent Required)",
				},
				disclaimer,
				{
					type: "paragraph",
					text: "[Participation terms for minors; guardian relationship and consent language.]",
				},
				{ type: "participant", role: "signer" },
				{
					type: "field",
					field_key: "minor_legal_name",
					label: "Minor's full legal name",
					field_type: "text",
					required: true,
				},
				{
					type: "field",
					field_key: "date_of_birth",
					label: "Minor's date of birth",
					field_type: "dob",
					required: true,
				},
				{ type: "participant", role: "guardian" },
				{
					type: "field",
					field_key: "guardian_legal_name",
					label: "Guardian's full legal name",
					field_type: "text",
					required: true,
				},
				{
					type: "field",
					field_key: "guardian_relationship",
					label: "Relationship to minor",
					field_type: "select",
					options: ["parent", "legal guardian", "other (specify in notes)"],
					required: true,
				},
				{
					type: "field",
					field_key: "guardian_phone",
					label: "Guardian phone",
					field_type: "phone",
					required: true,
				},
				{
					type: "initials",
					field_key: "guardian_consent",
					label:
						"Initial: I consent to the minor's participation and accept the terms above",
					required: true,
				},
				{
					type: "signature",
					field_key: "signature",
					label: "Guardian signature",
				},
			],
		},
	},
};

export const PRESET_KEYS = Object.keys(FIREARM_PRESETS);

/**
 * Instantiate a preset as a NEW draft template owned by the tenant.
 * The business customizes text before/after publish — presets are never auto-published.
 */
export function instantiatePreset(
	presetKey: string,
	nameOverride?: string,
):
	| {
			name: string;
			category: string;
			defaultValidityDays: number;
			guardianPolicy: Record<string, unknown>;
			title: string;
			schema: DocumentSchema;
	  }
	| undefined {
	const preset = FIREARM_PRESETS[presetKey];
	if (!preset) return undefined;
	return {
		name: nameOverride?.trim() || preset.name,
		category: preset.category,
		defaultValidityDays: preset.defaultValidityDays,
		guardianPolicy: preset.guardianPolicy,
		title: preset.name,
		schema: preset.schema,
	};
}
