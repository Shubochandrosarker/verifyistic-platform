/**
 * verifyistic.com (apex) — canonical redirect to www.verifyistic.com,
 * where the live Verifyistic site is served. Preserves path + query.
 */
export default {
	async fetch(request) {
		const url = new URL(request.url);
		url.hostname = "www.verifyistic.com";
		return Response.redirect(url.toString(), 301);
	},
};
