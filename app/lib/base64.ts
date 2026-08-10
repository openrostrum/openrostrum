/**
 * Bytes → base64 without Buffer (works in every Workers context). Chunked:
 * spreading a whole large array into String.fromCharCode overflows the
 * argument limit.
 */
export function bytesToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
