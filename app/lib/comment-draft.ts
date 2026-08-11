export type CommentDraft = {
	key: string;
	fileId: string;
	body: string;
};

export type CommentActionResult = {
	ok?: boolean;
	commentKey?: string;
	commentFileId?: string;
	commentBody?: string;
};

/**
 * A failed operation keeps its original key, file and body. Success rotates the
 * key and clears the body; while that new form is still blank it follows the
 * loader's latest file, then the first keystroke pins the draft to that version.
 */
export function resolveCommentDraft(
	draft: CommentDraft,
	result: CommentActionResult | undefined,
	currentFileId: string,
): CommentDraft {
	const key = result?.commentKey ?? draft.key;
	if (key === draft.key) return draft;
	return {
		key,
		fileId: result?.ok
			? currentFileId
			: (result?.commentFileId ?? currentFileId),
		body: result?.commentBody ?? "",
	};
}
