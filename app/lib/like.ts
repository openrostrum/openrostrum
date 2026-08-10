/**
 * %/_ in a user's search term are literals, not wildcards — escape them and
 * pair the pattern with `LIKE ... ESCAPE '\'`. One helper so every search
 * box treats "speaker_kit.pdf" as findable text, not a wildcard query.
 */
export function likeContains(term: string): string {
	return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
