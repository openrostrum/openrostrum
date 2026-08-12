import { z } from "zod";

/**
 * Ids read back from a store the browser owns — a cookie the visitor can
 * rewrite, localStorage another tab wrote. Non-strings drop one by one.
 */
export const StoredIds = z
	.array(z.unknown())
	.catch([])
	.transform((items) =>
		items.flatMap((item) => z.string().safeParse(item).data ?? []),
	);
