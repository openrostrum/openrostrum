// Verification infrastructure, NOT the app: the catch-all inbox for
// openrostrum.com. Cloudflare Email Routing delivers every inbound message
// here; we store it raw in D1 so agents can read real delivered mail:
//   wrangler d1 execute openrostrum-inbox --remote \
//     --command "SELECT rcpt_to, subject, raw FROM inbox ORDER BY received_at DESC LIMIT 1"
export default {
	async email(message, env) {
		const raw = await new Response(message.raw).text();
		await env.DB.prepare(
			"INSERT INTO inbox (id, received_at, mail_from, rcpt_to, subject, raw) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(
				crypto.randomUUID(),
				Date.now(),
				message.from,
				message.to,
				message.headers.get("subject") ?? "",
				raw,
			)
			.run();
	},
};
