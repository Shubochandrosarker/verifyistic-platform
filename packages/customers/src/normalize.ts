/** Contact normalization — the lookup columns (email_normalized, phone_normalized). */
export function normalizeEmail(
	email: string | null | undefined,
): string | null {
	if (email === null || email === undefined) return null;
	const trimmed = email.trim().toLowerCase();
	if (trimmed.length === 0 || !trimmed.includes("@") || trimmed.includes(" "))
		return null;
	return trimmed;
}

/** Digits with an optional leading +. Local formatting, spaces, dashes are dropped. */
export function normalizePhone(
	phone: string | null | undefined,
): string | null {
	if (phone === null || phone === undefined) return null;
	const trimmed = phone.trim();
	if (trimmed.length === 0) return null;
	const plus = trimmed.startsWith("+");
	const digits = [...trimmed].filter((ch) => ch >= "0" && ch <= "9").join("");
	if (digits.length === 0) return null;
	return plus ? `+${digits}` : digits;
}
