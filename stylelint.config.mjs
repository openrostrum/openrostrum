import globalCssOnly from "./tooling/stylelint-rules/global-css-only.mjs";

export default {
	plugins: [globalCssOnly],
	reportDescriptionlessDisables: true,
	reportInvalidScopeDisables: true,
	reportNeedlessDisables: true,
	rules: {
		"openrostrum/global-css-only": [true, { reportDisables: true }],
	},
};
