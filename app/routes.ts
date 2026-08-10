import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

/**
 * FILE-BASED ROUTING (no shared chokepoint). Every feature owns its route by
 * dropping a file in `app/routes/` — it does NOT edit this file. This is what
 * lets ~50 agents add routes in parallel with zero merge conflicts here.
 * Conventions (Remix/RR flat routes):
 *   _index.tsx            → /
 *   submissions.tsx       → /submissions
 *   admin.forms.tsx       → /admin/forms (child of an admin.tsx layout, if any)
 *   submissions.$id.tsx   → /submissions/:id
 * See docs/rules/tech-stack.md → routing.
 */
export default flatRoutes() satisfies RouteConfig;
