import { ButtonLink, TableFooter } from "~/ui";
import { REVIEW_PAGE_SIZE } from "./evaluation";

export function Pager({
	page,
	total,
	link,
	pageSize = REVIEW_PAGE_SIZE,
}: {
	page: number;
	total: number;
	link: (page: number) => string;
	pageSize?: number;
}) {
	if (total <= pageSize) return null;
	const pages = Math.max(1, Math.ceil(total / pageSize));
	return (
		<div className="flex items-center gap-3">
			{page > 1 && (
				<ButtonLink to={link(page - 1)} variant="ghost">
					Previous
				</ButtonLink>
			)}
			<TableFooter>
				{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
				{total}
			</TableFooter>
			{page < pages && (
				<ButtonLink to={link(page + 1)} variant="ghost">
					Next
				</ButtonLink>
			)}
		</div>
	);
}
