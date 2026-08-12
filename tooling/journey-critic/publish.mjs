const LABEL = "journey-critic";
const ISSUE_TITLE = "Journey critic — open experience findings";

export function createGithub({ token, repo }) {
	async function call(method, path, body) {
		const response = await fetch(`https://api.github.com${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				accept: "application/vnd.github+json",
				"content-type": "application/json",
				"user-agent": "journey-critic",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok)
			throw new Error(
				`${method} ${path} → ${response.status} ${await response.text()}`,
			);
		return response.json();
	}

	return {
		async ensureLabel() {
			await call("POST", `/repos/${repo}/labels`, {
				name: LABEL,
				color: "b45309",
				description: "Experience defects found by walking the live product",
			}).catch(() => undefined);
		},
		async findLedgerIssue() {
			const issues = await call(
				"GET",
				`/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`,
			);
			return issues.find((issue) => !issue.pull_request) ?? null;
		},
		createIssue(body) {
			return call("POST", `/repos/${repo}/issues`, {
				title: ISSUE_TITLE,
				body,
				labels: [LABEL],
			});
		},
		updateIssue(number, body) {
			return call("PATCH", `/repos/${repo}/issues/${number}`, { body });
		},
		comment(number, body) {
			return call("POST", `/repos/${repo}/issues/${number}/comments`, { body });
		},
	};
}
