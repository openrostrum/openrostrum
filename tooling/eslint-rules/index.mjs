import { noGenericInstanceof } from "./no-generic-instanceof.mjs";
import { noRawTailwindColors } from "./no-raw-tailwind-colors.mjs";
import { preferErrorNormalizer } from "./prefer-error-normalizer.mjs";
import { structuredTailwindClassname } from "./structured-tailwind-classname.mjs";

// Local ESLint plugin. Rules ported from cloudflare-agent-exercise (the ones
// that apply to this stack). Skipped there: cloudflare-workflow-determinism (no
// Workflows/Durable Objects) and require-discriminated-agent-variants (no AI agents).
export const killmysaasPlugin = {
	meta: { name: "killmysaas", version: "0.0.0" },
	rules: {
		"no-generic-instanceof": noGenericInstanceof,
		"no-raw-tailwind-colors": noRawTailwindColors,
		"prefer-error-normalizer": preferErrorNormalizer,
		"structured-tailwind-classname": structuredTailwindClassname,
	},
};
