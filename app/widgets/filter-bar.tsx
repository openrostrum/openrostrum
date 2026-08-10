import type { ChangeEvent } from "react";
import { Form } from "react-router";
import { Button, Field, SearchInput, Select, TextLink } from "~/ui";
import { makeHref } from "./bits";
import type { ProgramFacets, ProgramFilters } from "./types";

/**
 * SSR search + faceted filters as a GET form: the URL is the state, so results
 * are shareable, Back works, and everything functions without client JS
 * (selects also auto-submit when JS is present).
 */
export function FilterBar({
	base,
	filters,
	facets,
	searchPlaceholder,
	extraParams = {},
	facetKeys = ["track", "format", "room"],
}: {
	base: string;
	filters: ProgramFilters;
	facets: ProgramFacets;
	searchPlaceholder: string;
	/** Params to survive a filter submit (e.g. the itinerary's active day). */
	extraParams?: Record<string, string>;
	facetKeys?: Array<"track" | "format" | "room">;
}) {
	const active = filters.q || filters.track || filters.format || filters.room;
	const autoSubmit = (e: ChangeEvent<HTMLSelectElement>) =>
		e.currentTarget.form?.requestSubmit();
	const facetDefs = [
		{ key: "track" as const, label: "Track", options: facets.tracks },
		{ key: "format" as const, label: "Format", options: facets.formats },
		{ key: "room" as const, label: "Room", options: facets.rooms },
	].filter((f) => facetKeys.includes(f.key));
	return (
		<Form
			method="get"
			action={base}
			className="flex flex-wrap items-end gap-3"
			aria-label="Search and filters"
		>
			{Object.entries(extraParams).map(([name, value]) =>
				value ? (
					<input key={name} type="hidden" name={name} value={value} />
				) : null,
			)}
			<Field label="Search">
				<SearchInput
					name="q"
					defaultValue={filters.q}
					placeholder={searchPlaceholder}
				/>
			</Field>
			{facetDefs.map((facet) => (
				<Field key={facet.key} label={facet.label}>
					<Select
						name={facet.key}
						defaultValue={filters[facet.key]}
						onChange={autoSubmit}
					>
						<option value="">All {facet.label.toLowerCase()}s</option>
						{facet.options.map((option) => (
							<option key={option.id} value={option.id}>
								{option.name}
							</option>
						))}
					</Select>
				</Field>
			))}
			<Button type="submit" variant="ghost" icon="filter">
				Apply
			</Button>
			{active && <TextLink to={makeHref(base, extraParams)}>Clear</TextLink>}
		</Form>
	);
}
