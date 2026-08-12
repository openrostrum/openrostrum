import { meaningfulTests } from "./meaningful-tests.mjs";
import { noCitationComments } from "./no-citation-comments.mjs";
import { noCompatShims } from "./no-compat-shims.mjs";
import { noDarkVariants } from "./no-dark-variants.mjs";
import { noDeferralComments } from "./no-deferral-comments.mjs";
import { noGenericInstanceof } from "./no-generic-instanceof.mjs";
import { noLongComments } from "./no-long-comments.mjs";
import { noLooseVariantObjects } from "./no-loose-variant-objects.mjs";
import { noRawTailwindColors } from "./no-raw-tailwind-colors.mjs";
import { noRuntimeTypeof } from "./no-runtime-typeof.mjs";
import { preferErrorNormalizer } from "./prefer-error-normalizer.mjs";
import { pureNavModules } from "./pure-nav-modules.mjs";
import { requireAuthInActions } from "./require-auth-in-actions.mjs";
import { structuredTailwindClassname } from "./structured-tailwind-classname.mjs";
import { uiPrimitivesOnly } from "./ui-primitives-only.mjs";

// Local ESLint plugin. Rules ported from cloudflare-agent-exercise (the ones
// that apply to this stack). Skipped there: cloudflare-workflow-determinism (no
// Workflows/Durable Objects) and require-discriminated-agent-variants (no AI agents).
export const openrostrumPlugin = {
	meta: { name: "openrostrum", version: "0.0.0" },
	rules: {
		"meaningful-tests": meaningfulTests,
		"no-citation-comments": noCitationComments,
		"no-compat-shims": noCompatShims,
		"no-dark-variants": noDarkVariants,
		"no-deferral-comments": noDeferralComments,
		"no-generic-instanceof": noGenericInstanceof,
		"no-long-comments": noLongComments,
		"no-loose-variant-objects": noLooseVariantObjects,
		"no-raw-tailwind-colors": noRawTailwindColors,
		"no-runtime-typeof": noRuntimeTypeof,
		"prefer-error-normalizer": preferErrorNormalizer,
		"pure-nav-modules": pureNavModules,
		"require-auth-in-actions": requireAuthInActions,
		"structured-tailwind-classname": structuredTailwindClassname,
		"ui-primitives-only": uiPrimitivesOnly,
	},
};
