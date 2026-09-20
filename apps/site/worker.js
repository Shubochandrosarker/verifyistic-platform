const appUrl = "https://app.verifyistic.com";
const apiUrl = "https://api.verifyistic.com";

const responseHeaders = {
	"Content-Type": "text/html; charset=UTF-8",
	"Cache-Control": "public, max-age=300, s-maxage=3600",
	"Content-Security-Policy":
		"default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://api.verifyistic.com https://app.verifyistic.com",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			});
		}
		const route = normalizePath(url.pathname);
		if (route === "/robots.txt") {
			return new Response(
				"User-agent: *\nAllow: /\nDisallow: /app\nSitemap: https://verifyistic.com/sitemap.xml\n# Machine-readable product context: https://verifyistic.com/llms.txt\n",
				{ headers: { "Content-Type": "text/plain; charset=UTF-8" } },
			);
		}
		if (route === "/sitemap.xml") {
			return new Response(sitemap(), {
				headers: { "Content-Type": "application/xml; charset=UTF-8" },
			});
		}
		if (route === "/sitemap.html") return htmlResponse(htmlSitemapPage());
		if (route === "/llms.txt") return textResponse(llmsTxt());
		if (route === "/llms-full.txt") return textResponse(llmsFullTxt());
		if (route === "/") return htmlResponse(landingPage());
		if (route === "/pricing") return htmlResponse(detailPage("pricing"));
		if (route === "/features") return htmlResponse(detailPage("features"));
		if (route === "/use-cases") return htmlResponse(detailPage("use-cases"));
		if (route === "/use-cases/shooting-ranges")
			return htmlResponse(detailPage("shooting-ranges"));
		if (route === "/use-cases/ffl-retailers")
			return htmlResponse(detailPage("ffl-retailers"));
		if (route === "/use-cases/firearms-instructors")
			return htmlResponse(detailPage("firearms-instructors"));
		if (route === "/how-it-works")
			return htmlResponse(detailPage("how-it-works"));
		if (route === "/compare") return htmlResponse(detailPage("compare"));
		if (route === "/privacy-policy")
			return htmlResponse(
				infoPage("Privacy policy", privacyContent(), "privacy-policy"),
			);
		if (route === "/terms")
			return htmlResponse(
				infoPage("Terms of service", termsContent(), "terms"),
			);
		if (route === "/security")
			return htmlResponse(
				infoPage("Security overview", securityContent(), "security"),
			);
		if (route === "/docs")
			return htmlResponse(
				infoPage("Developer documentation", docsContent(), "docs"),
			);
		return htmlResponse(
			infoPage(
				"Page not found",
				`<h2>The page is not available</h2><p>Return to the Verifyistic product site or open the dashboard to continue.</p><a class="button button-primary" href="/">Return home ${arrowIcon()}</a>`,
			),
			404,
		);
	},
};

function htmlResponse(body, status = 200) {
	return new Response(body, { status, headers: responseHeaders });
}

function textResponse(body) {
	return new Response(body, {
		headers: {
			"Content-Type": "text/plain; charset=UTF-8",
			"Cache-Control": "public, max-age=300, s-maxage=3600",
		},
	});
}

function normalizePath(pathname) {
	return pathname.length > 1 && pathname.endsWith("/")
		? pathname.slice(0, -1)
		: pathname;
}

function layout(content, title, description, path = "/", structuredData = "") {
	const canonical = `https://verifyistic.com${path === "/" ? "/" : `${path}/`}`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><style>${styles}</style>${structuredData ? `<script type="application/ld+json">${structuredData}</script>` : ""}</head><body>${content}</body></html>`;
}

function landingPage(initialSection = "") {
	return layout(
		`
<main id="top">
<header class="site-header"><div class="nav-shell"><a class="brand" href="/#top" aria-label="Verifyistic home"><span class="brand-mark">${shieldIcon()}</span><span>Verify<span class="accent">istic</span></span><span class="product">SIGN</span></a><nav aria-label="Primary navigation"><a href="/#features">Features</a><a href="/#workflow">How it works</a><a href="/#why">Why Verifyistic</a><a href="/#pricing">Pricing</a></nav><div class="nav-actions"><button class="theme-toggle" type="button" aria-label="Switch to dark mode">◔</button><a class="sign-in" href="${appUrl}">Sign in</a><a class="button small" href="${appUrl}">Start free ${arrowIcon()}</a><button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false">☰</button></div></div><div class="mobile-nav" hidden><a href="/#features">Features</a><a href="/#workflow">How it works</a><a href="/#why">Why Verifyistic</a><a href="/#pricing">Pricing</a><a href="${appUrl}">Sign in</a></div></header>
<section class="hero shell"><div class="hero-copy reveal"><div class="eyebrow"><i></i> Purpose-built for ranges, FFLs &amp; firearms instructors</div><h1>Proof for every signature.<br><em>Speed for every counter.</em></h1><p class="lead">Create, collect, seal, and retrieve digital waivers without per-signature fees or a generic enterprise workflow getting in the way.</p><div class="hero-actions"><a class="button primary large" href="${appUrl}">Start your 14-day trial ${arrowIcon()}</a><a class="button secondary large" href="#workflow">See the workflow</a></div><ul class="proof-list"><li>${checkIcon()} Unlimited signatures on every paid plan</li><li>${checkIcon()} Versioned templates preserve exact signed text</li><li>${checkIcon()} REST API and retry-safe webhooks included</li></ul></div>${consolePreview()}</section>
<section class="proof-strip"><div class="shell proof-grid"><div><b>ESIGN + UETA</b><span>Evidence-rich signing trail</span></div><div><b>SHA-256 SEALED</b><span>Tamper-evident documents</span></div><div><b>API INCLUDED</b><span>Connect POS, CRM, or booking</span></div><div><b>PORTABLE RECORDS</b><span>Standard PDF + JSON exports</span></div></div></section>
<section class="section shell" id="why"><div class="heading center reveal"><span class="kicker">Built around the actual risk</span><h2>Waiver software should remove friction—<br>not create another system to manage.</h2></div><div class="three-grid">${reasonCard("01", "Keep the counter moving", "Customers sign ahead, by QR, or from a locked-down kiosk while staff see status immediately.")}${reasonCard("02", "Keep the record defensible", "The exact document version, consent, timestamp, IP, signature, and audit certificate stay together.")}${reasonCard("03", "Keep your systems connected", "API keys and lifecycle webhooks turn a completed signature into the next automated action.")}</div></section>
<section class="section workflow" id="workflow"><div class="shell split"><div class="heading reveal"><span class="kicker">A complete evidence chain</span><h2>One smooth signing flow.<br><em>Every proof point preserved.</em></h2><p>Verifyistic follows a waiver from its exact published text to the sealed record and downstream system—without a manual handoff in the middle.</p></div><div class="step-grid">${stepCard("01 · BUILD", "Publish the exact waiver", "Use your attorney-approved text, signer fields, initials, and required acknowledgments. Every revision becomes a preserved version.")}${stepCard("02 · PRESENT", "Send, embed, QR, or kiosk", "Meet customers before arrival, on their phone, or at a locked-down front-counter tablet. One template, every signing channel.")}${stepCard("03 · CAPTURE", "Record consent and identity", "Attach signer details, consent, timestamp, IP, device context, and signature method. The evidence stays with the document.")}${stepCard("04 · SEAL & ROUTE", "Create the proof package", "Generate the signed PDF, audit certificate, verification hash, and webhook event. Your next workflow starts automatically.")}</div></div></section>
<section class="section shell" id="features"><div class="heading center reveal"><span class="kicker">The complete waiver layer</span><h2>Detailed where risk matters.<br><em>Simple where people sign.</em></h2><p>Every capability is designed around repeat, high-volume signing—not generic one-off envelopes.</p></div><div class="feature-grid">${featureCard("Templates with immutable version history", "Publish a new revision without changing any old record. Each signer stays tied to the precise text, fields, and disclosures they saw.", `<div class="versions"><span>v1 <b>Archived</b><small>428 records</small></span><span>v2 <b>Archived</b><small>761 records</small></span><span class="current">v3 <b>Current</b><small>Range Liability Waiver</small></span></div>`)}${featureCard("Counter-ready kiosk mode", "A focused, staff-safe signing screen resets automatically for the next guest.", `<div class="kiosk"><small>RANGE CHECK-IN</small><strong>Ready for the next guest</strong><button type="button">Start waiver ${arrowIcon()}</button></div>`)}${featureCard("Sealed PDF + audit certificate", "Every completion becomes a portable proof package—not a row trapped in a dashboard.", `<div class="files"><span>waiver-signed.pdf</span><span>audit-certificate.pdf</span><span>SHA-256 fingerprint</span><span>Public verification hash</span></div>`)}${featureCard("API and retry-safe webhooks", "Create signing sessions from your POS, booking flow, CRM, or custom app. Subscribe to completion events with delivery retries.", `<div class="api-box"><b>api.verifyistic.com</b><code>POST /v1/sessions<br>{ "template_id": 42,<br>  "signer_id": "c_1048" }</code><strong>201 · signing URL created</strong></div>`)}${featureCard("Find any record fast", "Search by signer, email, phone, date, template, status, or location—and export the result when needed.", `<div class="search-box"><span>⌘ K</span><b>Alex Morgan</b><small>Range Liability Waiver · Complete</small><b>Jamie Carter</b><small>Membership release · Pending</small></div>`)}${featureCard("Your data stays portable", "Export standard PDF and JSON records any time. Self-hosted ownership is available for teams that need full infrastructure control.", `<div class="exports"><b>PDF</b><b>JSON</b><b>CSV</b><b>API</b></div>`)}</div></section>
<section class="section dark-section"><div class="shell"><div class="heading center reveal"><span class="kicker">Features are only useful when operations improve</span><h2>Less counter friction.<br><em>Stronger records. Cleaner automation.</em></h2></div><div class="three-grid outcomes">${outcomeCard("Operations", "Shorter check-in", "Pre-sign links, QR access, and kiosk mode move paperwork away from the busiest moment at the counter.")}${outcomeCard("Risk", "A complete evidence trail", "The signed text, consent, identity context, timestamps, and certificate are packaged together.")}${outcomeCard("Automation", "No manual next step", "A completion event can update a member, confirm a booking, notify staff, or unlock check-in.")}</div></div></section>
<section class="section shell comparison"><div class="heading center reveal"><span class="kicker">Choose the workflow, not just the signature</span><h2>Why firearms businesses outgrow generic tools.</h2></div><div class="table-wrap"><table><thead><tr><th>What matters at the counter</th><th>Verifyistic</th><th>Generic e-sign</th><th>Basic waiver app</th></tr></thead><tbody><tr><td>Unlimited signatures without per-envelope math</td><td>Included</td><td>Often metered</td><td>Plan dependent</td></tr><tr><td>Kiosk, QR, pre-sign, and embedded flows</td><td>Built in</td><td>Manual setup</td><td>Usually included</td></tr><tr><td>Exact template version preserved per signer</td><td>Full history</td><td>Document history</td><td>Varies</td></tr><tr><td>API + webhook automation on standard plans</td><td>Included</td><td>Often premium</td><td>Often limited</td></tr><tr><td>Portable PDF, audit certificate, and JSON</td><td>Complete package</td><td>PDF + certificate</td><td>Usually PDF</td></tr></tbody></table></div><p class="note">Capabilities can vary by provider and plan. Verify details before making a purchasing decision.</p></section>
<section class="section shell"><div class="heading center reveal"><span class="kicker">Made for the full firearms customer journey</span><h2>One signing layer.<br><em>Three operational realities.</em></h2><p>Start with waivers, acknowledgments, and agreements. Keep each workflow specific to the way your business actually operates.</p></div><div class="three-grid">${useCaseCard("Shooting ranges", "Range waivers, safety rules, rentals, memberships, events, and fast front-counter status.", ["Kiosk + QR signing", "Minor/guardian workflows", "Repeat-visitor lookup"])}${useCaseCard("FFL retailers", "Customer acknowledgments, policy acceptance, transfers, and document workflows organized by location.", ["Location-specific templates", "Searchable customer records", "POS-ready API events"])}${useCaseCard("Firearms instructors", "Collect training waivers and releases before class, then route completion into registration and attendance.", ["Pre-class signing links", "Mobile-first forms", "Automated confirmation"])}</div></section>
<section class="section shell" id="pricing"><div class="heading center reveal"><span class="kicker">Flat pricing · unlimited signatures</span><h2>Choose your operating scale.<br><em>Not your signature count.</em></h2><p>Every plan includes templates, kiosk signing, sealed records, API access, and webhooks.</p></div><div class="pricing-grid">${priceCard("Range", "$49", "Single-location ranges and independent instructors.", ["Unlimited signatures & signers", "Templates + version history", "Kiosk and QR signing", "API + webhooks"])}${priceCard("Range Pro", "$99", "Growing ranges with staff, automation, and branded flows.", ["Everything in Range", "White-label signer pages", "Team seats and roles", "Automation packs + priority support"], true)}${priceCard("FFL Network", "$199", "Multi-store FFLs, franchises, and complex operations.", ["Everything in Range Pro", "Per-location templates", "Customer database + search", "Bulk migration support"])}</div><div class="self-hosted"><span class="server">${serverIcon()}</span><div><small>SELF-HOSTED OWNERSHIP</small><h3>Run the complete platform on your infrastructure.</h3><p>Your server, database, storage, API, and signing workflow—with platform updates included.</p></div><strong>$2,999 <small>one-time · single site</small></strong><a class="button secondary" href="mailto:jolly@wordpressistic.com?subject=Verifyistic%20self-hosted%20license">Talk to us</a></div></section>
<section class="section faq"><div class="shell split"><div class="heading"><span class="kicker">Questions before you switch</span><h2>Clear answers.<br><em>No legal-tech fog.</em></h2><p>Need to discuss a specific workflow? <a href="mailto:jolly@wordpressistic.com?subject=Verifyistic%20workflow%20question">Book a practical walkthrough.</a></p></div><div class="faq-list"><details open><summary>Are electronic signatures valid for range waivers in the U.S.? <b>+</b></summary><p>Federal ESIGN law and state electronic-transaction laws generally recognize electronic signatures. Enforceability also depends on the waiver language, how consent is presented, and applicable state law. Verifyistic records the signing evidence; your attorney should review the waiver itself.</p></details><details><summary>What happens after I publish a new waiver version? <b>+</b></summary><p>New signers receive the current version. Existing records remain attached to the exact version they signed, so publishing v3 never rewrites a v1 or v2 record.</p></details><details><summary>Can customers sign before they arrive? <b>+</b></summary><p>Yes. Send a secure link, embed the flow on your site, place a QR code in confirmations, or use kiosk mode at the counter.</p></details><details><summary>Do API access and webhooks cost extra? <b>+</b></summary><p>No. Scoped API access and core lifecycle webhooks are included on every paid plan.</p></details><details><summary>What does the self-hosted license include? <b>+</b></summary><p>It includes the signing engine, template management, kiosk experience, API, webhooks, and record layer for one site on your infrastructure.</p></details></div></div></section>
<section class="final-cta shell"><div><span class="kicker">Your next customer should not meet a clipboard</span><h2>Make the signature the easiest<br>part of the visit.</h2><p>Build your first template, test the signing flow, and see the complete proof package before you switch anything.</p></div><div class="cta-actions"><a class="button primary large" href="${appUrl}">Start your 14-day trial ${arrowIcon()}</a><a class="button ghost large" href="mailto:jolly@wordpressistic.com?subject=Verifyistic%20walkthrough">Book a walkthrough</a></div></section>
<footer><div class="shell footer-grid"><div><a class="brand" href="/#top"><span class="brand-mark">${shieldIcon()}</span><span>Verify<span class="accent">istic</span></span><span class="product">SIGN</span></a><p>Digital waivers and e-signatures built for firearms-business workflows.</p><span>A WordPressistic LLC product.</span></div><div><b>PRODUCT</b><a href="/#features">Features</a><a href="/#workflow">How it works</a><a href="/#pricing">Pricing</a></div><div><b>ACCESS</b><a href="${appUrl}">Dashboard</a><a href="${apiUrl}/v1/health">API status</a><a href="/docs/">Developer docs</a><a href="mailto:jolly@wordpressistic.com">Contact</a></div><div><b>TRUST</b><a href="/privacy-policy/">Privacy policy</a><a href="/terms/">Terms of service</a><a href="/security/">Security overview</a></div></div><div class="shell footer-bottom"><span>© 2026 WordPressistic LLC</span><span>Verifyistic is software, not legal advice.</span></div></footer></main><script>${clientScript(initialSection)}</script>`,
		"Verifyistic Sign — Digital Waivers for Firearms Businesses",
		"Digital waivers and e-signatures built for shooting ranges, FFLs, and firearms instructors—with kiosk signing, sealed audit records, API access, and no per-signature fees.",
	);
}

const detailPages = {
	features: {
		path: "/features",
		kicker: "Product capabilities",
		title: "Digital waiver software for the work behind every signature.",
		description:
			"Explore Verifyistic features for digital waivers, kiosk signing, immutable template versions, sealed audit records, APIs, webhooks, and operational search.",
		intro:
			"Verifyistic is a signing and evidence layer for high-volume firearms-business workflows. It keeps the customer experience short while preserving the operational detail staff need later.",
		sections: [
			[
				"templates",
				"Immutable template versions",
				"Publish a new waiver revision without rewriting history. Every completed record stays attached to the exact text, fields, acknowledgments, and disclosures the signer saw.",
				[
					"Draft, publish, and retire versions",
					"Preserve historical signatures verbatim",
					"Require re-consent when a newer version matters",
				],
			],
			[
				"kiosk",
				"Kiosk, QR, pre-sign, and embedded flows",
				"Move paperwork away from the busiest moment at the counter. Send a secure link before arrival, embed the signing flow, use a QR code, or keep a focused kiosk ready for the next guest.",
				[
					"Front-counter kiosk mode",
					"Mobile-first pre-sign links",
					"QR and embedded signing targets",
				],
			],
			[
				"evidence",
				"Sealed PDF and audit certificate",
				"A completed session becomes a portable proof package with the signed document, evidence record, certificate, hashes, and verification path—not just a row in a dashboard.",
				[
					"Signed PDF artifact",
					"Audit certificate and event history",
					"Hash-linked verification record",
				],
			],
			[
				"automation",
				"API and retry-safe webhooks",
				"Connect a POS, membership system, booking flow, CRM, or custom app. The API creates signing sessions, and lifecycle events can start the next business action.",
				[
					"Scoped API keys",
					"Idempotent create flows",
					"Signed webhook delivery with bounded retries",
				],
			],
			[
				"operations",
				"Search, roles, locations, and migration",
				"Give staff the right view for the right location. Find a record by signer, email, phone, date, template, status, or location, and keep imported history accessible.",
				[
					"Tenant and site-scoped access",
					"Location-specific templates",
					"Portable PDF and JSON exports",
				],
			],
		],
		faq: [
			[
				"Does Verifyistic charge per signature?",
				"The public plans are positioned around operating scale rather than per-signature envelopes. Confirm the current plan details before purchase.",
			],
			[
				"Can Verifyistic replace legal review?",
				"No. Verifyistic records the signing evidence; the business and its counsel remain responsible for waiver language and legal sufficiency.",
			],
		],
	},
	"use-cases": {
		path: "/use-cases",
		kicker: "Use cases",
		title: "One signing layer for three firearms-business realities.",
		description:
			"See how Verifyistic supports shooting ranges, FFL retailers, and firearms instructors with focused digital waiver workflows.",
		intro:
			"The same evidence model can support different counter, classroom, and location workflows. Start with the document customers must sign, then connect it to the operational event that follows.",
		sections: [
			[
				"ranges",
				"Shooting ranges",
				"Keep the line moving with pre-sign links, QR access, kiosk signing, minor and guardian branches, and a front-desk status view.",
				[
					"Range waivers and safety acknowledgments",
					"Membership, rental, event, and repeat-visitor flows",
					"Fast exception handling at the counter",
				],
			],
			[
				"retailers",
				"FFL retailers",
				"Organize customer acknowledgments, policy acceptance, transfer-related paperwork, and document workflows by store or location without pretending to replace regulated systems.",
				[
					"Location-specific templates",
					"Searchable customer records",
					"POS-ready API events",
				],
			],
			[
				"instructors",
				"Firearms instructors",
				"Collect training waivers and releases before class, then route completion into registration, attendance, and confirmation workflows.",
				[
					"Pre-class signing links",
					"Mobile-first forms",
					"Automated completion notifications",
				],
			],
		],
		faq: [
			[
				"Is Verifyistic a replacement for a bound book or Form 4473?",
				"No. Verifyistic is a waiver, acknowledgment, and evidence workflow. It does not claim to replace regulated FFL records or legal processes.",
			],
			[
				"Can one organization support multiple locations?",
				"The platform is designed around organizations, sites, roles, and location-specific templates; confirm the plan and configuration for your rollout.",
			],
		],
	},
	"shooting-ranges": {
		path: "/use-cases/shooting-ranges",
		kicker: "Use case · shooting ranges",
		title: "Shorter range check-in. Stronger waiver records.",
		description:
			"A practical digital waiver workflow for shooting ranges: pre-sign links, QR access, kiosk signing, repeat visitors, and staff status.",
		intro:
			"Range staff should be able to see who is ready, who needs attention, and which exact waiver version is on record—without making every customer fill out the same clipboard again.",
		sections: [
			[
				"before",
				"Before the customer arrives",
				"Send a secure signing link in a booking confirmation, membership email, or reminder. The customer can complete the waiver on a phone before reaching the counter.",
				[
					"Pre-arrival signing",
					"QR code from booking or confirmation",
					"Clear completion status",
				],
			],
			[
				"counter",
				"At the counter",
				"Use a focused kiosk or a staff-assisted flow for walk-ins. Keep the signing screen simple, then reset for the next guest.",
				[
					"Kiosk-ready presentation",
					"Minor and guardian workflow support",
					"Fast status lookup",
				],
			],
			[
				"after",
				"After the signature",
				"A sealed proof package and completion event make the waiver useful to the rest of the operation—membership, booking, check-in, or staff notification.",
				[
					"PDF and audit certificate",
					"Completion webhook",
					"Searchable customer record",
				],
			],
		],
		faq: [
			[
				"Can a range keep using its own waiver language?",
				"Yes. The workflow is designed around customer-supplied, attorney-reviewed text and preserved published versions.",
			],
			[
				"What happens when the waiver changes?",
				"New signers receive the current version while existing records remain attached to the exact version they signed.",
			],
		],
	},
	"ffl-retailers": {
		path: "/use-cases/ffl-retailers",
		kicker: "Use case · FFL retailers",
		title:
			"A document workflow that respects the complexity of an FFL counter.",
		description:
			"Use Verifyistic for FFL customer acknowledgments, location-specific templates, searchable records, and POS-connected events.",
		intro:
			"FFL retailers manage customer communication, store policies, transfers, and regulated workflows at the same counter. Verifyistic handles the signing evidence layer and leaves regulated decisions to the systems and professionals responsible for them.",
		sections: [
			[
				"location",
				"Keep templates organized by location",
				"Use location-specific versions for store policies, acknowledgments, and customer-facing agreements while preserving a clear history of what was published.",
				[
					"Location-scoped templates",
					"Version history",
					"Role-aware staff access",
				],
			],
			[
				"records",
				"Find the record when staff need it",
				"Search by customer, contact detail, date, template, or status instead of manually reconstructing a paper trail.",
				["Customer search", "Status visibility", "Exportable record packages"],
			],
			[
				"connect",
				"Connect the next operational action",
				"Use the API and signed webhooks to notify a system or staff workflow when a document is completed.",
				[
					"Scoped API access",
					"Retry-safe events",
					"POS and CRM integration seam",
				],
			],
		],
		faq: [
			[
				"Does this automate regulated FFL compliance?",
				"No. It supports document and acknowledgment workflows. It does not replace legal advice, regulated records, background-check systems, or Form 4473 processes.",
			],
			[
				"Can staff access be separated by location?",
				"The product model supports organizations, sites, and roles; choose the configuration that matches your operating structure.",
			],
		],
	},
	"firearms-instructors": {
		path: "/use-cases/firearms-instructors",
		kicker: "Use case · firearms instructors",
		title: "Collect the release before class starts.",
		description:
			"Help firearms instructors collect training waivers and releases before class, confirm completion, and keep evidence tied to the right student and session.",
		intro:
			"The best training day starts with the paperwork already handled. Verifyistic gives instructors a mobile-first signing link and an operational record they can find after the class.",
		sections: [
			[
				"enroll",
				"Send the link with registration",
				"Include a secure signing URL in the registration or confirmation flow so students can review and sign before arrival.",
				["Pre-class links", "Mobile-first signing", "Clear outstanding status"],
			],
			[
				"class",
				"Keep attendance moving",
				"Use a simple staff view to identify completed releases and route exceptions without stopping the entire class.",
				["Completion status", "Repeat-student lookup", "Staff-friendly flow"],
			],
			[
				"follow-up",
				"Keep the record portable",
				"Retain the signed document and audit evidence with the class record, then connect completion to your confirmation or CRM workflow.",
				["Proof package", "API and webhook handoff", "PDF and JSON export"],
			],
		],
		faq: [
			[
				"Can instructors use their own release language?",
				"Yes. Instructors should use text reviewed for their activity and jurisdiction; Verifyistic preserves the version presented to each signer.",
			],
			[
				"Can I use it for multiple classes?",
				"Use templates and customer records to support repeat workflows, subject to the plan and organization configuration.",
			],
		],
	},
	"how-it-works": {
		path: "/how-it-works",
		kicker: "How it works",
		title: "From published waiver to portable proof package.",
		description:
			"Understand the Verifyistic signing lifecycle: publish, present, capture, seal, verify, and route the completion event.",
		intro:
			"Verifyistic keeps the human signing experience simple and the evidence chain explicit. Each stage has a clear input, output, and operational purpose.",
		sections: [
			[
				"publish",
				"1. Publish the exact text",
				"Start with an attorney-approved waiver or acknowledgment. Define fields, required consent, and the version that customers will see.",
				[
					"Draft and validate fields",
					"Publish an immutable version",
					"Keep prior versions available",
				],
			],
			[
				"present",
				"2. Present the right signing path",
				"Send, embed, QR, or kiosk the same template through the channel that fits your business.",
				[
					"Secure signer URL",
					"Pre-arrival and front-counter flows",
					"No private API key in browser code",
				],
			],
			[
				"capture",
				"3. Capture consent and identity context",
				"The session records signer input, consent, timestamp, IP, device context, and signature method according to the workflow.",
				[
					"Server-side validation",
					"Guardian and conditional branches",
					"Audit event chain",
				],
			],
			[
				"seal",
				"4. Seal and route the proof",
				"The worker finalizes the signed document, certificate, hashes, and verification data, then emits lifecycle events for downstream automation.",
				[
					"Private document storage",
					"Authorized downloads",
					"Signed retry-safe webhooks",
				],
			],
		],
		faq: [
			[
				"Is the signing URL public?",
				"The signer transport uses a high-entropy expiring token. Treat the URL as private and do not publish it in logs or analytics.",
			],
			[
				"What if a webhook endpoint is offline?",
				"The delivery engine retries with bounded backoff and records a dead-letter state after the configured attempts.",
			],
		],
	},
	compare: {
		path: "/compare",
		kicker: "Category comparison",
		title: "Why a firearms business may outgrow a generic e-sign tool.",
		description:
			"A practical comparison of Verifyistic with generic e-signature and basic waiver software across counter workflow, evidence, automation, and portability.",
		intro:
			"The question is not only whether a customer can sign. It is whether the business can keep the counter moving, find the exact record later, and connect completion to the next operational action.",
		sections: [
			[
				"workflow",
				"Counter workflow",
				"Generic e-sign tools often begin with an envelope. Verifyistic begins with a repeatable business workflow: pre-sign, QR, kiosk, embed, staff status, and exception handling.",
				[
					"Range-ready signing paths",
					"Focused kiosk experience",
					"Customer and staff status",
				],
			],
			[
				"evidence",
				"Evidence and version history",
				"A signature is easier to defend when the exact text, consent, identity context, timestamps, and certificate stay together.",
				[
					"Immutable published versions",
					"Audit events",
					"Portable proof package",
				],
			],
			[
				"automation",
				"Automation without a premium integration tier",
				"Scoped API access and core lifecycle webhooks are part of the product model, so a completed signing can become a business trigger.",
				[
					"Idempotent API patterns",
					"Signed webhook events",
					"Retry and dead-letter handling",
				],
			],
			[
				"ownership",
				"Portability and infrastructure choice",
				"Export standard records when needed, and use the self-hosted path when infrastructure control is a business requirement.",
				[
					"PDF and JSON export",
					"Private storage boundary",
					"Self-hosted ownership option",
				],
			],
		],
		faq: [
			[
				"Is Verifyistic always better than a generic e-sign tool?",
				"No. The right choice depends on volume, workflow, evidence needs, integrations, budget, and legal review. Verifyistic is purpose-built for the stated use cases.",
			],
			[
				"Do plans and capabilities change?",
				"They can. Confirm current pricing, limits, and feature availability before making a purchasing decision.",
			],
		],
	},
	pricing: {
		path: "/pricing",
		kicker: "Pricing",
		title: "Choose your operating scale, not your signature count.",
		description:
			"Verifyistic pricing for shooting ranges, firearms instructors, FFL networks, and self-hosted ownership.",
		intro:
			"Every public plan is designed around a business operating model. The exact commercial terms and availability should be confirmed before purchase.",
		sections: [
			[
				"range",
				"Range · $49 / month",
				"For a single-location range or independent instructor that needs the core signing workflow without per-envelope math.",
				[
					"Unlimited signatures and signers",
					"Templates and version history",
					"Kiosk and QR signing",
					"API and webhooks",
				],
			],
			[
				"pro",
				"Range Pro · $99 / month",
				"For growing teams that need staff roles, branded flows, and more automation around the counter.",
				[
					"Everything in Range",
					"White-label signer pages",
					"Team seats and roles",
					"Automation packs and priority support",
				],
			],
			[
				"network",
				"FFL Network · $199 / month",
				"For multi-store FFLs, franchises, and operations with location-specific templates and record search.",
				[
					"Everything in Range Pro",
					"Per-location templates",
					"Customer database and search",
					"Bulk migration support",
				],
			],
			[
				"self-hosted",
				"Self-hosted ownership · $2,999 one-time",
				"For a single site that needs the complete signing and record platform on its own infrastructure.",
				[
					"Signing engine and template management",
					"API, webhooks, and record layer",
					"One-site ownership scope",
					"Updates handled under the license",
				],
			],
		],
		faq: [
			[
				"Are these prices guaranteed?",
				"No. They reflect the current public positioning and should be verified on the live checkout or with the Verifyistic team.",
			],
			[
				"Does every plan include API access?",
				"The public product positioning includes API access and webhooks; confirm current plan terms before purchase.",
			],
		],
	},
};

function detailPage(key) {
	const page = detailPages[key];
	const faq = page.faq ?? [];
	const schema = JSON.stringify({
		"@context": "https://schema.org",
		"@type": "WebPage",
		name: page.title,
		description: page.description,
		url: `https://verifyistic.com${page.path}/`,
		isPartOf: {
			"@type": "WebSite",
			name: "Verifyistic",
			url: "https://verifyistic.com/",
		},
		mainEntity: faq.length
			? {
					"@type": "FAQPage",
					mainEntity: faq.map(([question, answer]) => ({
						"@type": "Question",
						name: question,
						acceptedAnswer: { "@type": "Answer", text: answer },
					})),
				}
			: undefined,
	});
	return layout(
		`<header class="site-header"><div class="nav-shell"><a class="brand" href="/"><span class="brand-mark">${shieldIcon()}</span><span>Verify<span class="accent">istic</span></span><span class="product">SIGN</span></a><nav aria-label="Primary navigation"><a href="/features/">Features</a><a href="/how-it-works/">How it works</a><a href="/use-cases/">Use cases</a><a href="/pricing/">Pricing</a></nav><div class="nav-actions"><a class="button small" href="${appUrl}">Start free ${arrowIcon()}</a></div></div></header><main class="detail shell"><div class="breadcrumbs"><a href="/">Verifyistic</a><span>/</span><span>${page.kicker}</span></div><div class="detail-hero"><span class="kicker">${page.kicker}</span><h1>${page.title}</h1><p class="lead">${page.intro}</p><div class="hero-actions"><a class="button primary large" href="${appUrl}">Start your 14-day trial ${arrowIcon()}</a><a class="button secondary large" href="/docs/">Read the docs</a></div></div><div class="detail-layout"><aside class="toc"><b>On this page</b>${page.sections.map(([id, title]) => `<a href="#${id}">${title}</a>`).join("")}<a href="#faq">Questions</a></aside><div class="detail-sections">${page.sections.map(([id, title, text, bullets], index) => `<section class="detail-section reveal" id="${id}"><span class="detail-index">${String(index + 1).padStart(2, "0")}</span><div><h2>${title}</h2><p>${text}</p><ul>${bullets.map((bullet) => `<li>${checkIcon()} ${bullet}</li>`).join("")}</ul></div></section>`).join("")}<section class="detail-faq" id="faq"><span class="kicker">Questions</span><h2>Clear answers before you build.</h2>${faq.map(([question, answer]) => `<details><summary>${question}<b>+</b></summary><p>${answer}</p></details>`).join("")}</section></div></div><section class="related"><span class="kicker">Continue exploring</span><div><a href="/features/">All features ${arrowIcon()}</a><a href="/use-cases/">Use cases ${arrowIcon()}</a><a href="/compare/">Compare approaches ${arrowIcon()}</a><a href="/security/">Security overview ${arrowIcon()}</a></div></section></main><footer><div class="shell footer-bottom"><span>© 2026 WordPressistic LLC</span><span>Verifyistic is software, not legal advice.</span></div></footer><script>${clientScript("")}</script>`,
		`${page.title} | Verifyistic`,
		page.description,
		page.path,
		schema,
	);
}

function consolePreview() {
	return `<div class="hero-visual reveal"><div class="glow"></div><div class="console"><div class="console-top"><span>● ● ●</span><b>Range Liability Waiver</b><em>● Live</em></div><div class="console-body"><div class="document"><small>CURRENT TEMPLATE</small><h3>Range waiver · v3 <mark>✓ Verified</mark></h3><div class="lines"><i></i><i></i><i></i><i></i></div><p class="consent">${checkIcon()} I have read and consent to sign electronically.</p><div class="signature"><small>SIGNATURE</small><strong>Alex Morgan</strong></div><button class="seal">Complete &amp; seal ${arrowIcon()}</button></div><div class="audit"><small>LIVE AUDIT TRAIL</small><p>${fileIcon()} <span><b>Consent captured</b><small>14:32:06 · mobile</small></span></p><p>${shieldIcon()} <span><b>Identity recorded</b><small>Timestamp + IP</small></span></p><p>${fileIcon()} <span><b>Document sealed</b><small>SHA-256 verified</small></span></p><div class="ready">${checkIcon()} <span><b>Proof package ready</b><small>PDF + audit certificate</small></span><strong>0.9s</strong></div></div></div></div><span class="chip chip-a">${sparkIcon()} Kiosk ready</span><span class="chip chip-b">${fileIcon()} $0 per signature</span></div>`;
}

function reasonCard(number, title, text) {
	return `<article class="reason reveal"><small>${number}</small><h3>${title}</h3><p>${text}</p></article>`;
}
function stepCard(number, title, text) {
	return `<article class="step reveal"><small>${number}</small><h3>${title}</h3><p>${text}</p></article>`;
}
function featureCard(title, text, visual) {
	return `<article class="feature reveal"><div><h3>${title}</h3><p>${text}</p></div>${visual}</article>`;
}
function outcomeCard(label, title, text) {
	return `<article class="outcome reveal"><small>${label}</small><h3>${title}</h3><p>${text}</p></article>`;
}
function useCaseCard(title, text, items) {
	return `<article class="use-card reveal"><h3>${title}</h3><p>${text}</p><ul>${items.map((item) => `<li>${checkIcon()} ${item}</li>`).join("")}</ul></article>`;
}
function priceCard(name, price, text, items, featured = false) {
	return `<article class="price-card ${featured ? "featured" : ""}">${featured ? '<span class="popular">MOST POPULAR</span>' : ""}<small>${name.toUpperCase()}</small><div class="price"><strong>${price}</strong><span>/ month</span></div><p>${text}</p><a class="button ${featured ? "primary" : "secondary"}" href="${appUrl}">Start free ${arrowIcon()}</a><ul>${items.map((item) => `<li>${checkIcon()} ${item}</li>`).join("")}</ul></article>`;
}

function infoPage(title, content, slug) {
	return layout(
		`<header class="site-header"><div class="nav-shell"><a class="brand" href="/"><span class="brand-mark">${shieldIcon()}</span><span>Verify<span class="accent">istic</span></span><span class="product">SIGN</span></a><a class="button small" href="/">Back to site ${arrowIcon()}</a></div></header><main class="info shell"><span class="kicker">Verifyistic trust center</span><h1>${title}</h1><p class="lead">Clear product information for businesses evaluating digital waiver and e-signature workflows.</p><div class="info-copy">${content}</div></main><footer><div class="shell footer-bottom"><span>© 2026 WordPressistic LLC</span><span>Verifyistic is software, not legal advice.</span></div></footer>`,
		`Verifyistic — ${title}`,
		`${title} for Verifyistic Sign.`,
		`/${slug}`,
	);
}
function privacyContent() {
	return `<h2>What this policy covers</h2><p>This policy describes how Verifyistic handles information when a business uses Verifyistic Sign, the dashboard, the hosted signer experience, or the public website.</p><h2>Information processed</h2><p>Depending on the workflow, the service may process organization and staff account details, signer contact details, waiver fields, signature evidence, timestamps, IP address, device context, audit events, and files uploaded or generated by the customer.</p><h2>Why it is used</h2><p>We use this information to provide signing, document generation, verification, support, security, billing, and customer-requested automation. Customer organizations control waiver content and should provide their own notices to signers where required.</p><h2>Contact</h2><p>For privacy questions, contact <a href="mailto:jolly@wordpressistic.com">jolly@wordpressistic.com</a>. This page is general product information, not legal advice.</p>`;
}
function termsContent() {
	return `<h2>Using Verifyistic</h2><p>Verifyistic provides software for digital waivers, acknowledgments, signatures, document evidence, and related operational workflows. You are responsible for your waiver content, user permissions, and use of the service.</p><h2>Customer responsibilities</h2><p>Keep account credentials and API keys confidential, use lawful content, configure appropriate retention, and obtain notices or consents required for your business and jurisdiction.</p><h2>Legal review</h2><p>Verifyistic records signing evidence. It does not decide whether a particular waiver is sufficient, enforceable, or appropriate for a specific state, activity, or business. Have counsel review your documents and workflow.</p><h2>Questions</h2><p>For account or product questions, contact <a href="mailto:jolly@wordpressistic.com">jolly@wordpressistic.com</a>.</p>`;
}
function securityContent() {
	return `<h2>Security model</h2><p>Verifyistic separates the public marketing site, authenticated dashboard, API, asynchronous worker, and private document storage. Business records are tenant-scoped and sensitive document downloads use authorized short-lived access.</p><h2>Evidence integrity</h2><p>Signing workflows preserve the exact template version, capture audit events, and generate hash-linked proof artifacts. Completed legal artifacts are treated as immutable records.</p><h2>Access controls</h2><p>API keys are scoped, stored as hashes, and can be restricted to sites. Webhook secrets are encrypted at rest and delivery uses signed requests with replay protection.</p><h2>Responsible disclosure</h2><p>Contact <a href="mailto:jolly@wordpressistic.com">jolly@wordpressistic.com</a> with a concise description and safe reproduction details. Do not include live customer records or credentials.</p>`;
}
function docsContent() {
	return `<h2>Start with the API</h2><p>The live API exposes its OpenAPI document at <a href="${apiUrl}/v1/openapi.json">${apiUrl}/v1/openapi.json</a> and human-readable route documentation at <a href="${apiUrl}/v1/docs">${apiUrl}/v1/docs</a>.</p><h2>Typical flow</h2><ol><li>Create a customer and select a published template version.</li><li>Create a signing session with the customer and delivery method.</li><li>Send or embed the signer URL in your workflow.</li><li>Receive lifecycle webhooks and download authorized proof artifacts.</li></ol><h2>Production boundary</h2><p>Keep API keys and webhook secrets on your server. Never place private credentials in browser code, public repositories, or WordPress page source.</p><a class="button primary" href="${apiUrl}/v1/docs">Open API docs ${arrowIcon()}</a>`;
}
const publicUrls = [
	[
		"/",
		"Verifyistic Sign product overview",
		"Digital waivers and e-signatures for firearms-business workflows.",
	],
	[
		"/features/",
		"Verifyistic features",
		"Templates, kiosk signing, evidence, API, webhooks, search, and exports.",
	],
	[
		"/use-cases/",
		"Verifyistic use cases",
		"Workflows for shooting ranges, FFL retailers, and firearms instructors.",
	],
	[
		"/use-cases/shooting-ranges/",
		"Verifyistic for shooting ranges",
		"Pre-sign, QR, kiosk, repeat-visitor, and counter status workflows.",
	],
	[
		"/use-cases/ffl-retailers/",
		"Verifyistic for FFL retailers",
		"Location-aware customer acknowledgments and document evidence workflows.",
	],
	[
		"/use-cases/firearms-instructors/",
		"Verifyistic for firearms instructors",
		"Pre-class signing, attendance readiness, and portable records.",
	],
	[
		"/how-it-works/",
		"How Verifyistic works",
		"Publish, present, capture, seal, verify, and route.",
	],
	[
		"/compare/",
		"Verifyistic comparison",
		"How the workflow differs from generic e-sign and basic waiver tools.",
	],
	[
		"/pricing/",
		"Verifyistic pricing",
		"Plans for ranges, instructors, FFL networks, and self-hosted ownership.",
	],
	[
		"/docs/",
		"Verifyistic developer documentation",
		"OpenAPI, signing sessions, webhooks, and integration boundaries.",
	],
	[
		"/security/",
		"Verifyistic security overview",
		"Tenant boundaries, private artifacts, scoped access, and signed webhooks.",
	],
	[
		"/privacy-policy/",
		"Verifyistic privacy policy",
		"How Verifyistic handles account, signer, evidence, and service information.",
	],
	[
		"/terms/",
		"Verifyistic terms of service",
		"Service use, customer responsibilities, and legal review boundaries.",
	],
];

function sitemap() {
	return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicUrls.map(([path]) => `<url><loc>https://verifyistic.com${path}</loc></url>`).join("")}</urlset>`;
}

function htmlSitemapPage() {
	return layout(
		`<header class="site-header"><div class="nav-shell"><a class="brand" href="/"><span class="brand-mark">${shieldIcon()}</span><span>Verify<span class="accent">istic</span></span><span class="product">SIGN</span></a><a class="button small" href="/">Back to site ${arrowIcon()}</a></div></header><main class="sitemap-page shell"><span class="kicker">Site index</span><h1>Explore Verifyistic.</h1><p class="lead">A structured index of product, use-case, developer, trust, and commercial pages. Each page is written for people and machine-readable assistants.</p><div class="sitemap-list">${publicUrls.map(([path, title, description]) => `<a href="${path}"><span><b>${title}</b><small>${description}</small></span>${arrowIcon()}</a>`).join("")}</div></main><footer><div class="shell footer-bottom"><span>© 2026 WordPressistic LLC</span><span>Verifyistic is software, not legal advice.</span></div></footer>`,
		"Verifyistic sitemap — Product and trust pages",
		"A human-readable sitemap for Verifyistic product, use-case, developer, trust, and pricing pages.",
		"/sitemap.html",
	);
}

function llmsTxt() {
	return `# Verifyistic

> Verifyistic Sign is digital waiver and e-signature software for shooting ranges, FFL retailers, and firearms instructors.

## Canonical site
- https://verifyistic.com/

## What Verifyistic does
- Creates signing sessions from published waiver templates.
- Preserves immutable template versions so a completed record remains tied to the text presented to the signer.
- Supports pre-sign links, QR access, embedded flows, and counter-ready kiosk workflows.
- Produces signed PDF and audit-certificate proof packages with verification hashes.
- Exposes scoped API access and signed lifecycle webhooks for business automation.
- Supports tenant, site, role, retention, and private-document boundaries.

## Best pages for answering questions
- Features: https://verifyistic.com/features/
- Use cases: https://verifyistic.com/use-cases/
- Shooting ranges: https://verifyistic.com/use-cases/shooting-ranges/
- FFL retailers: https://verifyistic.com/use-cases/ffl-retailers/
- Firearms instructors: https://verifyistic.com/use-cases/firearms-instructors/
- How it works: https://verifyistic.com/how-it-works/
- Comparison: https://verifyistic.com/compare/
- Pricing: https://verifyistic.com/pricing/
- Developer docs: https://verifyistic.com/docs/
- Security: https://verifyistic.com/security/
- HTML sitemap: https://verifyistic.com/sitemap.html

## Important boundaries
- Verifyistic is software, not legal advice.
- It does not claim to replace a waiver attorney, regulated FFL records, Form 4473, NICS, or other compliance systems.
- Plan details, capabilities, and legal requirements should be verified before purchase or deployment.

## Machine-readable references
- XML sitemap: https://verifyistic.com/sitemap.xml
- Full product context: https://verifyistic.com/llms-full.txt
- API health: ${apiUrl}/v1/health
- OpenAPI document: ${apiUrl}/v1/openapi.json
`;
}

function llmsFullTxt() {
	return `# Verifyistic — full product context

## Identity
Verifyistic Sign is a WordPressistic LLC product focused on digital waivers, acknowledgments, e-signatures, evidence, and operational automation. The primary audience is firearms-business operators: shooting ranges, FFL retailers, and firearms instructors.

## Product summary
Verifyistic connects a business's customer-facing signing moment to the record and workflow that follow. A business can publish a structured waiver template, create a signer session, present it before arrival or at a counter, validate required fields and consent, generate a signed proof package, and route a completion event to another system.

## Core concepts
1. Organization: the tenant boundary for business data.
2. Site: a location or website boundary within an organization.
3. Customer: the signer or business contact associated with a workflow.
4. Template and template version: the structured waiver definition and the immutable published version shown to a signer.
5. Signing session: an expiring, revocable workflow instance for one customer and template version.
6. Document: the completed evidence record and its protected proof artifacts.
7. Webhook: a signed lifecycle event for downstream automation.

## Primary workflows

### Shooting ranges
Use pre-sign links, QR codes, kiosk mode, and repeat-visitor lookup to reduce front-counter friction. Keep status visible to staff and preserve the exact range waiver version, signer evidence, and certificate.

### FFL retailers
Use location-specific templates and customer acknowledgments for customer-facing document workflows. Verifyistic can connect completion events to POS, CRM, or staff workflows. It does not replace regulated FFL records, Form 4473, NICS, legal advice, or a bound book.

### Firearms instructors
Send a waiver or release with class registration, collect signatures before arrival, identify outstanding records, and route completion to attendance or confirmation workflows.

## Feature detail
- Immutable template history prevents a new publication from rewriting old signed records.
- Signer transport supports secure, expiring session links.
- The evidence model captures consent, signer fields, timestamps, IP and device context where configured, signature method, and lifecycle events.
- The asynchronous worker finalizes documents and sends webhooks with bounded retry behavior.
- Authorized downloads protect private PDF, certificate, and manifest artifacts.
- Scoped API keys can be restricted to sites; raw key material is not stored as plaintext.
- Webhook endpoint secrets are encrypted at rest and delivered with replay-aware signed requests.
- Standard PDF and JSON export supports portability; self-hosted ownership is available as a commercial path.

## How it differs from generic tools
Generic e-sign tools often center on an envelope. Verifyistic centers on the repeated operating flow around a waiver: pre-sign, QR, kiosk, exact template version, status lookup, evidence package, API, and completion event. A generic tool may still be the right choice for a different workflow. Verify the current plans and capabilities before purchasing.

## Pricing context
The public positioning uses operating-scale plans: Range, Range Pro, FFL Network, and a self-hosted ownership option. Public prices are subject to change; treat the pricing page and checkout as authoritative.

## Legal and trust boundaries
Verifyistic records evidence; it does not decide whether a waiver is enforceable or legally sufficient. Businesses should have counsel review their waiver language, disclosures, consent presentation, retention, and jurisdictional requirements. Do not describe Verifyistic as a universal compliance certification.

## Canonical pages
${publicUrls.map(([path, title, description]) => `- ${title}: https://verifyistic.com${path} — ${description}`).join("\n")}

## Live integration references
- Dashboard: ${appUrl}
- API health: ${apiUrl}/v1/health
- Human API docs: ${apiUrl}/v1/docs
- OpenAPI: ${apiUrl}/v1/openapi.json
- Contact: mailto:jolly@wordpressistic.com
`;
}

function clientScript(initialSection) {
	return `(function(){var root=document.documentElement,saved=localStorage.getItem('verifyistic-theme');if(saved)root.dataset.theme=saved;else if(window.matchMedia('(prefers-color-scheme: dark)').matches)root.dataset.theme='dark';var theme=document.querySelector('.theme-toggle');if(theme)theme.onclick=function(){var next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('verifyistic-theme',next)};var menu=document.querySelector('.menu-toggle'),mobile=document.querySelector('.mobile-nav');if(menu&&mobile)menu.onclick=function(){var open=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!open));mobile.hidden=open};document.querySelectorAll('a[href^="#"]').forEach(function(link){link.onclick=function(event){var target=document.querySelector(link.getAttribute('href'));if(target){event.preventDefault();target.scrollIntoView({behavior:'smooth'});history.replaceState(null,'',link.getAttribute('href'));if(mobile){mobile.hidden=true;menu&&menu.setAttribute('aria-expanded','false')}}}});var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target)}})},{threshold:.12});document.querySelectorAll('.reveal').forEach(function(node){observer.observe(node)});if(${JSON.stringify(initialSection)}){var section=document.getElementById(${JSON.stringify(initialSection)});if(section)setTimeout(function(){section.scrollIntoView()},80)}})();`;
}
function shieldIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>`;
}
function arrowIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>`;
}
function checkIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>`;
}
function fileIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="m8 14 2 2 4-4"></path></svg>`;
}
function sparkIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7z"></path></svg>`;
}
function serverIcon() {
	return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2"></rect><rect width="20" height="8" x="2" y="14" rx="2"></rect><path d="M6 6h.01M6 18h.01"></path></svg>`;
}

const styles = String.raw`
:root{--bg:#f5f8f6;--surface:#fff;--soft:#edf5f1;--text:#062219;--muted:#65736e;--line:#dbe7e1;--green:#08b878;--green-dark:#078e61;--mint:#baf4dd;--shadow:0 24px 80px rgba(19,75,54,.12);--shell:1180px;color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.3;background-image:radial-gradient(rgba(8,49,35,.06) .7px,transparent .7px);background-size:6px 6px;z-index:-1}a{color:inherit;text-decoration:none}button{font:inherit;color:inherit}svg{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.shell{max-width:var(--shell);margin:0 auto;padding-left:28px;padding-right:28px}.site-header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(18px);border-bottom:1px solid color-mix(in srgb,var(--line) 75%,transparent)}.nav-shell{height:76px;max-width:var(--shell);margin:0 auto;padding:0 28px;display:flex;align-items:center;gap:24px}.brand{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:850;letter-spacing:-.055em;white-space:nowrap}.brand-mark{width:35px;height:35px;border-radius:11px;display:grid;place-items:center;background:var(--green);color:#043725;box-shadow:0 8px 20px rgba(8,184,120,.2)}.brand-mark svg{width:20px;height:20px}.accent{color:var(--green-dark)}.product{font-size:10px;letter-spacing:.1em;padding:4px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);margin-left:2px}.nav-shell nav{margin-left:auto;display:flex;gap:30px;font-size:13px;font-weight:700;color:var(--muted)}.nav-shell nav a:hover,.sign-in:hover{color:var(--green-dark)}.nav-actions{display:flex;align-items:center;gap:16px;margin-left:10px}.sign-in{font-size:13px;font-weight:750;color:var(--muted)}.theme-toggle,.menu-toggle{border:1px solid var(--line);background:var(--surface);border-radius:11px;width:38px;height:38px;display:grid;place-items:center;cursor:pointer}.theme-toggle:hover,.menu-toggle:hover{transform:translateY(-2px)}.menu-toggle{display:none}.mobile-nav{max-width:var(--shell);margin:0 auto;padding:0 28px 18px;gap:10px;flex-direction:column}.mobile-nav:not([hidden]){display:flex}.mobile-nav a{padding:9px 0;color:var(--muted);font-weight:700}.button{display:inline-flex;align-items:center;justify-content:center;gap:9px;border:1px solid transparent;border-radius:12px;padding:11px 17px;font-size:13px;font-weight:800;line-height:1;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease}.button svg{width:16px;height:16px}.button:hover{transform:translateY(-2px)}.button.primary,.button.small{background:var(--green);color:#032519;box-shadow:0 8px 22px rgba(8,184,120,.18)}.button.primary:hover,.button.small:hover{background:#16cd89}.button.secondary{background:var(--surface);border-color:var(--line);color:var(--text)}.button.ghost{background:transparent;border-color:rgba(186,244,221,.35);color:#edf9f3}.button.large{padding:16px 20px}.button.small{padding:12px 15px}.hero{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);align-items:center;gap:54px;min-height:710px;padding-top:76px;padding-bottom:76px}.eyebrow,.kicker{color:var(--green-dark);font-weight:850;text-transform:uppercase;letter-spacing:.105em;font-size:11px}.eyebrow{display:flex;align-items:center;gap:8px}.eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(8,184,120,.12)}h1,h2,h3,p{margin-top:0}h1,h2,h3{letter-spacing:-.06em;line-height:.98}h1{font-size:clamp(56px,6.6vw,92px);max-width:640px;margin:27px 0 25px;font-weight:920}.hero h1 em,h2 em{font-style:normal;color:var(--green-dark)}.lead{max-width:555px;font-size:18px;color:var(--muted);line-height:1.65;margin-bottom:28px}.hero-actions{display:flex;flex-wrap:wrap;gap:12px}.proof-list{display:grid;gap:11px;margin:31px 0 0;padding:0;list-style:none;color:var(--muted);font-size:12px;font-weight:650}.proof-list li{display:flex;align-items:center;gap:8px}.proof-list svg,.use-card li svg,.price-card li svg{width:14px;color:var(--green-dark);stroke-width:3}.hero-visual{position:relative;min-height:465px;display:grid;place-items:center}.glow{position:absolute;width:85%;height:70%;border-radius:50%;background:radial-gradient(circle,rgba(139,246,202,.48),transparent 70%);filter:blur(14px)}.console{position:relative;width:min(100%,600px);border:1px solid rgba(14,78,54,.12);border-radius:23px;background:var(--surface);box-shadow:var(--shadow);overflow:hidden;transform:rotate(-1.3deg);animation:float 7s ease-in-out infinite}.console-top{height:49px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:center;position:relative;font-size:10px;color:var(--muted)}.console-top>span{position:absolute;left:16px;color:#fa927d;letter-spacing:3px}.console-top em{position:absolute;right:16px;font-style:normal;background:var(--mint);color:var(--green-dark);padding:5px 9px;border-radius:999px;font-weight:800}.console-body{display:grid;grid-template-columns:1.15fr .85fr;min-height:387px}.document{padding:35px 27px 27px;border-right:1px solid var(--line)}.document>small,.audit>small,.signature small,.kiosk small{font-size:9px;font-weight:850;color:var(--muted);letter-spacing:.12em}.document h3{font-size:17px;margin:8px 0 28px}.document mark{float:right;background:var(--soft);color:var(--green-dark);font-size:9px;padding:6px 8px;border-radius:8px}.lines{display:grid;gap:8px;margin:29px 0 19px}.lines i{height:7px;border-radius:5px;background:var(--soft)}.lines i:nth-child(1){width:86%}.lines i:nth-child(2){width:72%}.lines i:nth-child(3){width:93%}.lines i:nth-child(4){width:60%}.consent{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:11px;padding:10px;font-size:10px;color:var(--muted)}.consent svg{background:var(--green);color:#043725;border-radius:5px;padding:2px;width:16px;height:16px;stroke-width:3}.signature{border:1px solid var(--line);border-radius:12px;height:83px;padding:13px;margin-top:13px}.signature strong{display:block;font-family:"Segoe Script",cursive;font-size:23px;color:var(--green-dark);margin-top:17px}.seal{width:100%;border:0;background:var(--green);color:#043725;border-radius:10px;padding:12px;font-size:11px;font-weight:850;margin-top:13px}.seal svg{width:14px;vertical-align:middle}.audit{padding:35px 22px;background:linear-gradient(180deg,var(--soft),var(--surface));color:var(--muted)}.audit>p{display:flex;align-items:center;gap:10px;margin:22px 0;font-size:11px}.audit>p>svg{width:20px;color:var(--green-dark);padding:4px;border:1px solid var(--line);background:var(--surface);border-radius:6px}.audit p span,.ready span{display:block}.audit p b,.audit p small,.ready b,.ready small{display:block}.audit p b,.ready b{font-size:10px;color:var(--text)}.audit p small,.ready small{font-size:9px;margin-top:3px}.ready{display:flex;align-items:center;gap:8px;border:1px solid rgba(8,184,120,.35);border-radius:12px;padding:10px;background:var(--surface);font-size:9px}.ready>svg{width:25px;height:25px;background:var(--green);color:#043725;border-radius:50%;padding:6px}.ready>strong{margin-left:auto;color:var(--green-dark)}.chip{position:absolute;z-index:2;display:flex;align-items:center;gap:7px;padding:10px 13px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 25px rgba(19,75,54,.12);font-size:10px;font-weight:850;color:var(--muted)}.chip svg{width:15px;color:var(--green-dark)}.chip-a{top:56px;right:-4px}.chip-b{bottom:20px;left:0}.proof-strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface)}.proof-grid{display:grid;grid-template-columns:repeat(4,1fr);padding-top:24px;padding-bottom:24px;gap:22px}.proof-grid div{display:grid;gap:4px}.proof-grid b{font-size:11px;letter-spacing:.11em}.proof-grid span{font-size:12px;color:var(--muted)}.section{padding-top:112px;padding-bottom:112px}.heading{max-width:700px}.heading.center{text-align:center;margin:0 auto 50px}.heading h2{font-size:clamp(38px,4.6vw,64px);margin:18px 0 19px;font-weight:900}.heading p{font-size:16px;color:var(--muted);line-height:1.7;max-width:630px}.center p{margin-left:auto;margin-right:auto}.three-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.reason{border-top:2px solid var(--green);padding:22px 20px 0}.reason small,.step small,.outcome small{font-size:11px;letter-spacing:.12em;color:var(--green-dark);font-weight:850}.reason h3,.step h3,.outcome h3,.use-card h3{font-size:25px;margin:22px 0 12px}.reason p,.step p,.outcome p,.use-card p{font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:0}.workflow,.faq{background:var(--surface);max-width:none}.workflow .split,.faq .split{max-width:var(--shell);margin:auto;display:grid;grid-template-columns:.8fr 1.2fr;gap:75px}.step-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.step{border:1px solid var(--line);border-radius:16px;padding:23px;background:var(--bg);min-height:196px;transition:transform .2s ease,box-shadow .2s ease}.step:hover,.feature:hover,.use-card:hover,.price-card:hover{transform:translateY(-4px);box-shadow:0 18px 38px rgba(19,75,54,.1)}.step h3{font-size:20px;margin-top:26px}.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feature,.price-card,.use-card{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:24px;transition:transform .2s ease,box-shadow .2s ease}.feature{min-height:330px;display:flex;flex-direction:column;justify-content:space-between}.feature h3{font-size:22px;margin-bottom:11px}.feature p{font-size:13px;color:var(--muted);line-height:1.7}.versions,.files,.kiosk,.api-box,.search-box{display:grid;gap:8px;margin-top:20px}.versions span,.files span{display:grid;grid-template-columns:30px 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:10px;color:var(--muted)}.versions b{color:var(--text)}.versions small{font-size:9px}.versions .current{border-color:rgba(8,184,120,.45);background:var(--soft);color:var(--green-dark)}.kiosk,.api-box,.search-box{border:1px solid var(--line);border-radius:14px;background:var(--soft);padding:16px}.kiosk strong{display:block;margin-top:9px;font-size:17px}.kiosk button{width:100%;border:0;background:var(--green);color:#043725;border-radius:9px;padding:11px;font-weight:800;margin-top:18px}.files span{display:block;background:var(--soft);font-weight:750}.files span:nth-child(2){margin-left:18px}.files span:nth-child(3){margin-left:36px;color:var(--green-dark)}.files span:nth-child(4){margin-left:54px}.api-box{font-size:10px}.api-box b,.api-box strong{display:block;color:var(--green-dark)}.api-box code{display:block;background:var(--text);color:var(--mint);border-radius:9px;padding:13px;line-height:1.6;margin:9px 0}.search-box span{justify-self:end;border:1px solid var(--line);background:var(--surface);padding:3px 7px;border-radius:5px;font-size:10px}.search-box b{font-size:12px}.search-box small{font-size:10px;color:var(--muted);margin-bottom:6px}.dark-section{background:var(--text);color:#edf9f3;max-width:none}.dark-section .shell{max-width:var(--shell)}.dark-section .kicker{color:var(--mint)}.dark-section h2 em{color:var(--green)}.outcome{border-top:1px solid rgba(186,244,221,.3);padding-top:20px}.outcome p{color:#a5bcb2}.table-wrap{border:1px solid var(--line);border-radius:18px;overflow:auto;background:var(--surface)}table{width:100%;min-width:760px;border-collapse:collapse;text-align:left;font-size:12px}th,td{padding:16px 18px;border-bottom:1px solid var(--line)}th{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);background:var(--soft)}th:not(:first-child),td:not(:first-child){text-align:center}tbody tr:last-child td{border-bottom:0}tbody td:not(:first-child){color:var(--green-dark);font-weight:800}.note{color:var(--muted);font-size:11px}.use-card h3{font-size:27px}.use-card ul,.price-card ul{list-style:none;padding:0;margin:25px 0 0;display:grid;gap:12px}.use-card li,.price-card li{font-size:12px;font-weight:700;color:var(--muted);display:flex;align-items:center;gap:7px}.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.price-card{position:relative}.price-card.featured{border:2px solid var(--green);padding:23px;box-shadow:0 15px 40px rgba(8,184,120,.13)}.popular{position:absolute;top:0;right:24px;transform:translateY(-50%);background:var(--green);color:#043725;border-radius:999px;padding:6px 10px;font-size:9px;font-weight:900;letter-spacing:.08em}.price-card>small,.self-hosted>div>small{color:var(--muted);font-size:10px;letter-spacing:.13em;font-weight:900}.price{display:flex;align-items:baseline;gap:6px;margin:21px 0 8px}.price strong{font-size:49px;letter-spacing:-.08em}.price span{color:var(--muted);font-size:12px}.price-card>p{min-height:52px;color:var(--muted);font-size:13px}.price-card>.button{margin-top:12px;width:100%}.self-hosted{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:20px;background:var(--surface);border:1px solid var(--line);border-radius:18px;margin-top:16px;padding:25px}.server{width:48px;height:48px;display:grid;place-items:center;border-radius:13px;background:var(--soft);color:var(--green-dark)}.server svg{width:25px}.self-hosted h3{font-size:23px;margin:8px 0}.self-hosted p{font-size:13px;color:var(--muted);margin:0}.self-hosted>strong{font-size:28px;letter-spacing:-.06em}.self-hosted>strong small{display:block;font-size:10px;color:var(--muted);letter-spacing:normal}.faq-list{border-top:1px solid var(--line)}details{border-bottom:1px solid var(--line);padding:18px 0}summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:18px;font-weight:800;font-size:14px}summary::-webkit-details-marker{display:none}summary b{color:var(--green-dark);font-size:20px;transition:transform .18s ease}details[open] summary b{transform:rotate(45deg)}details p{color:var(--muted);font-size:13px;line-height:1.7;max-width:700px;margin:14px 0 0}.faq .heading a,.info-copy a{color:var(--green-dark);font-weight:800}.final-cta{margin-top:100px;margin-bottom:100px;border-radius:25px;background:var(--text);color:#edf9f3;display:flex;align-items:end;justify-content:space-between;gap:28px;padding-top:74px;padding-bottom:74px;position:relative;overflow:hidden}.final-cta .kicker{color:var(--mint)}.final-cta h2{font-size:clamp(38px,4.8vw,62px);margin:18px 0}.final-cta p{color:#a5bcb2;max-width:580px}.cta-actions{display:flex;gap:10px;flex-wrap:wrap;position:relative;z-index:1}footer{border-top:1px solid var(--line);padding-top:54px}.footer-grid{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:34px;padding-bottom:46px}.footer-grid>div{display:grid;align-content:start;gap:10px}.footer-grid p,.footer-grid span{color:var(--muted);font-size:12px}.footer-grid p{max-width:250px;margin:14px 0 0}.footer-grid b{font-size:11px;letter-spacing:.11em;margin-bottom:5px}.footer-grid a:not(.brand){font-size:12px;color:var(--muted)}.footer-bottom{border-top:1px solid var(--line);padding-top:18px;padding-bottom:22px;display:flex;justify-content:space-between;color:var(--muted);font-size:11px}.info{min-height:calc(100vh - 180px);padding-top:105px;padding-bottom:110px}.info h1{font-size:clamp(52px,7vw,84px);margin:22px 0}.info-copy{max-width:780px;margin-top:60px;border-top:1px solid var(--line);padding-top:34px}.info-copy h2{font-size:25px;margin:36px 0 12px}.info-copy p,.info-copy li{font-size:15px;color:var(--muted);line-height:1.8}.info-copy ol{padding-left:20px}.reveal{opacity:0;transform:translateY(18px);transition:opacity .55s ease,transform .55s ease}.reveal.visible{opacity:1;transform:none}@keyframes float{0%,100%{transform:rotate(-1.3deg) translateY(0)}50%{transform:rotate(-.2deg) translateY(-9px)}}
[data-theme=dark]{--bg:#071913;--surface:#0d241c;--soft:#143127;--text:#e7f7ef;--muted:#9ab3a8;--line:#26463a;--green:#25d28f;--green-dark:#4ce6a8;--mint:#b9f5db;color-scheme:dark}[data-theme=dark] .button.secondary,[data-theme=dark] .theme-toggle,[data-theme=dark] .menu-toggle{background:var(--surface)}
@media(max-width:980px){.nav-shell nav{gap:15px}.hero{grid-template-columns:1fr;gap:25px;padding-top:60px}.hero-copy{max-width:700px}.workflow .split,.faq .split{grid-template-columns:1fr;gap:45px}.feature-grid{grid-template-columns:repeat(2,1fr)}.self-hosted{grid-template-columns:auto 1fr auto}.self-hosted>.button{grid-column:2;justify-self:start}.footer-grid{grid-template-columns:1.5fr repeat(3,1fr)}}
@media(max-width:720px){.shell{padding-left:18px;padding-right:18px}.nav-shell{height:66px;padding:0 18px}.nav-shell nav,.sign-in{display:none}.nav-actions{margin-left:auto;gap:8px}.menu-toggle{display:grid}.hero{padding-top:48px;padding-bottom:58px;min-height:auto}h1{font-size:clamp(50px,15vw,75px)}.lead{font-size:16px}.hero-actions .button{width:100%}.hero-visual{min-height:360px}.console{width:100%;transform:none}.console-body{min-height:330px}.document{padding:24px 15px}.audit{padding:24px 13px}.audit>p{gap:6px;margin:17px 0}.audit p b{font-size:8px}.audit p small{font-size:8px}.consent{font-size:8px}.signature strong{font-size:17px}.chip{font-size:9px;padding:8px 10px}.chip-a{top:18px;right:-2px}.chip-b{bottom:0;left:-1px}.proof-grid{grid-template-columns:repeat(2,1fr);padding-top:20px;padding-bottom:20px;gap:17px}.proof-grid span{font-size:10px}.section{padding-top:75px;padding-bottom:75px}.heading h2{font-size:38px}.heading p{font-size:14px}.heading.center{margin-bottom:33px}.three-grid,.pricing-grid{grid-template-columns:1fr}.step-grid{grid-template-columns:1fr}.feature-grid{grid-template-columns:1fr}.feature{min-height:300px}.workflow .split,.faq .split{gap:28px}.table-wrap{margin-left:-18px;margin-right:-18px;border-radius:0;border-left:0;border-right:0}.self-hosted{grid-template-columns:auto 1fr;gap:14px}.self-hosted>.button{grid-column:1 / -1}.self-hosted>strong{text-align:right;font-size:22px}.self-hosted h3{font-size:20px}.final-cta{margin-top:45px;margin-bottom:60px;border-radius:0;padding-top:56px;padding-bottom:56px;align-items:start;flex-direction:column}.final-cta h2{font-size:41px}.cta-actions,.cta-actions .button{width:100%}.footer-grid{grid-template-columns:repeat(2,1fr);gap:30px}.footer-grid>div:first-child{grid-column:1 / -1}.footer-bottom{flex-direction:column;gap:8px}.info{padding-top:65px}.info h1{font-size:52px}}

.breadcrumbs{display:flex;gap:10px;color:var(--muted);font-size:12px;font-weight:700;padding-top:34px}.breadcrumbs a{color:var(--green-dark)}.detail{padding-top:0;padding-bottom:90px}.detail-hero{max-width:850px;padding:96px 0 72px}.detail-hero h1{max-width:900px;font-size:clamp(52px,7vw,90px);margin:20px 0 25px}.detail-layout{display:grid;grid-template-columns:230px 1fr;gap:72px}.toc{position:sticky;top:100px;align-self:start;display:grid;gap:11px;border-left:2px solid var(--line);padding-left:18px;font-size:12px}.toc b{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text);margin-bottom:5px}.toc a{color:var(--muted)}.toc a:hover{color:var(--green-dark)}.detail-sections{display:grid;gap:0}.detail-section{display:grid;grid-template-columns:55px 1fr;gap:23px;border-top:1px solid var(--line);padding:43px 0 48px;scroll-margin-top:95px}.detail-index{font-size:12px;letter-spacing:.12em;color:var(--green-dark);font-weight:900;padding-top:5px}.detail-section h2,.detail-faq h2{font-size:34px;margin:0 0 15px}.detail-section p{font-size:16px;color:var(--muted);line-height:1.75;max-width:720px}.detail-section ul{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:11px}.detail-section li{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:750;color:var(--text)}.detail-section li svg{width:15px;color:var(--green-dark);stroke-width:3}.detail-faq{border-top:1px solid var(--line);padding-top:46px;scroll-margin-top:95px}.detail-faq h2{margin-top:16px}.detail-faq details{max-width:760px}.related{border-top:1px solid var(--line);margin-top:60px;padding-top:30px}.related>div{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.related a{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:11px;background:var(--surface);padding:12px 14px;font-size:12px;font-weight:800}.related a:hover{border-color:var(--green);transform:translateY(-2px)}.related svg{width:14px}.sitemap-page{padding-top:100px;padding-bottom:110px;min-height:calc(100vh - 180px)}.sitemap-page h1{font-size:clamp(52px,7vw,88px);margin:20px 0}.sitemap-list{max-width:850px;margin-top:58px;border-top:1px solid var(--line)}.sitemap-list a{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:20px 0}.sitemap-list a:hover b{color:var(--green-dark)}.sitemap-list b,.sitemap-list small{display:block}.sitemap-list b{font-size:17px}.sitemap-list small{font-size:12px;color:var(--muted);margin-top:4px}.sitemap-list svg{width:18px;color:var(--green-dark)}
@media(max-width:720px){.detail-hero{padding:65px 0 48px}.detail-layout{grid-template-columns:1fr;gap:35px}.toc{position:static;display:flex;flex-wrap:wrap;border-left:0;border-bottom:1px solid var(--line);padding:0 0 18px}.toc b{width:100%}.toc a{border:1px solid var(--line);border-radius:999px;padding:7px 10px}.detail-section{grid-template-columns:1fr;gap:8px;padding:32px 0}.detail-section h2,.detail-faq h2{font-size:28px}.detail-section p{font-size:14px}.related{margin-top:35px}.sitemap-page{padding-top:65px}.sitemap-list{margin-top:38px}}
`;
