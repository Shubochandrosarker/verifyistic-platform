/**
 * Externally visible identifiers are UUIDs (data model v1, rule 1).
 * No sequential public IDs — signer tokens and document ids must not be enumerable (doc 07 §3).
 */
export type PrefixedId<Prefix extends string> = `${Prefix}_${string}`;

export function newId(): string {
	return crypto.randomUUID();
}

export function newPrefixedId<Prefix extends string>(
	prefix: Prefix,
): PrefixedId<Prefix> {
	return `${prefix}_${crypto.randomUUID()}` as PrefixedId<Prefix>;
}

export const newRequestId = () => newPrefixedId("req");
