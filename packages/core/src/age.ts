/** Calendar-aware age from an ISO date (YYYY-MM-DD) — the server-side guardian branch (doc 07 §7). */
export function ageFromDob(
	dob: string,
	today: Date = new Date(),
): number | null {
	const value = dob.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const birth = new Date(Date.UTC(year, month - 1, day));
	// Reject overflow dates (e.g. 2026-02-31 → Mar 3)
	if (
		birth.getUTCFullYear() !== year ||
		birth.getUTCMonth() !== month - 1 ||
		birth.getUTCDate() !== day
	) {
		return null;
	}
	let age = today.getUTCFullYear() - year;
	const beforeBirthday =
		today.getUTCMonth() < birth.getUTCMonth() ||
		(today.getUTCMonth() === birth.getUTCMonth() &&
			today.getUTCDate() < birth.getUTCDate());
	if (beforeBirthday) age -= 1;
	return age;
}

export function isMinor(
	dob: string,
	minAge: number,
	today: Date = new Date(),
): boolean {
	const age = ageFromDob(dob, today);
	if (age === null) return false;
	return age < minAge;
}
