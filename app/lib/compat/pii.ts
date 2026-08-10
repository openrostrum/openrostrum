/**
 * Hide-PII transforms for the compat API. Hide-PII is hardcoded ON for every
 * token — these run on every contact-bearing payload, there is no unmasked
 * path.
 */

/** `jane.smith@university.edu` → `j***@u***.edu` (Sessionboard's format). */
export function maskEmail(email: string): string {
	const at = email.indexOf("@");
	if (at < 1) return "***";
	const local = `${email[0]}***`;
	const domain = email.slice(at + 1);
	const lastDot = domain.lastIndexOf(".");
	if (lastDot <= 0) return `${local}@***`;
	return `${local}@${domain[0]}***.${domain.slice(lastDot + 1)}`;
}

/** `+1 (555) 123-4567` → `***-***-4567`; under 4 digits masks fully. */
export function maskPhone(phone: string | null): string | null {
	if (!phone) return null;
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 4) return "***-***-****";
	return `***-***-${digits.slice(-4)}`;
}
