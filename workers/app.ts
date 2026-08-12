import { createRequestHandler } from "react-router";
import { runScheduledJobs } from "../app/jobs/registry";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		return requestHandler(request, {
			cloudflare: { env, ctx },
		});
	},

	// Cron Triggers (wired in wrangler.json `triggers.crons`). Cloudflare invokes
	// this once per matching trigger with `controller.cron` set to the expression;
	// the registry routes it to the `app/jobs/*.scheduled.ts` jobs declaring that
	// cadence — a job adds a file, not an edit here (app/jobs/registry.ts).
	async scheduled(controller, env, ctx) {
		await runScheduledJobs(controller.cron, env, ctx);
	},

	// Queue consumer. Same rationale; a feature that needs a queue declares the
	// queue + consumer in wrangler.json and dispatches from here. No queue is
	// declared today, so this handler is unreachable.
	async queue(_batch, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
