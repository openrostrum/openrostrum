import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

/**
 * FILE-BASED ROUTING, so this file is not a shared chokepoint: a feature owns
 * its route by dropping a file in `app/routes/` and never edits here.
 * The filename → URL conventions live in docs/rules/tech-stack.md → routing.
 */
export default flatRoutes() satisfies RouteConfig;
