/**
 * Role presets → capabilities (doc 06 §2). Role names are permission presets,
 * NOT the authorization engine: checks always go through hasCapability().
 */
export const ROLES = [
	"owner",
	"admin",
	"compliance_manager",
	"front_desk",
	"template_manager",
	"auditor",
	"developer",
] as const;

export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
	"org:manage",
	"sites:manage",
	"users:manage",
	"templates:manage",
	"documents:read",
	"documents:void",
	"retention:manage",
	"audit:read",
	"checkin:use",
	"api_keys:manage",
	"webhooks:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const READ_ONLY: Capability[] = ["documents:read", "audit:read"];

const ROLE_CAPABILITIES: Record<Role, readonly (Capability | "*")[]> = {
	owner: ["*"],
	admin: [
		"org:manage",
		"sites:manage",
		"users:manage",
		"templates:manage",
		"documents:read",
		"documents:void",
		"retention:manage",
		"audit:read",
		"checkin:use",
		"api_keys:manage",
		"webhooks:manage",
	],
	compliance_manager: [
		"templates:manage",
		"documents:read",
		"documents:void",
		"retention:manage",
		"audit:read",
	],
	front_desk: ["checkin:use", "documents:read"],
	template_manager: ["templates:manage", "documents:read"],
	auditor: READ_ONLY,
	developer: ["api_keys:manage", "webhooks:manage", "documents:read"],
};

export function capabilitiesForRole(role: Role): readonly Capability[] {
	const granted = ROLE_CAPABILITIES[role];
	if (granted.includes("*")) return [...CAPABILITIES];
	return granted as readonly Capability[];
}

export function hasCapability(role: Role, required: Capability): boolean {
	return (
		ROLE_CAPABILITIES[role].includes("*") ||
		ROLE_CAPABILITIES[role].includes(required)
	);
}
