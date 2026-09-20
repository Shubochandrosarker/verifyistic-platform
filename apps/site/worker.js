/**
 * Verifyistic marketing site (verifyistic.com) — single-worker, zero-dependency.
 * SEO: semantic HTML, meta/OG/Twitter/JSON-LD, canonical. UI: CSS-keyframe animated
 * hero, gradient mesh, pricing grid (live Paddle plans), self-hosted section.
 */
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Verifyistic — Digital Waivers, Age Verification & E-Signatures for Shooting Ranges</title>
<meta name="description" content="Verifyistic gives shooting ranges digital waivers, age verification, e-signatures and check-in with tamper-evident audit evidence. Cloud or self-hosted. WordPress ready. From $19/mo or $599 perpetual."/>
<link rel="canonical" href="https://verifyistic.com/"/>
<meta name="robots" content="index,follow"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Verifyistic"/>
<meta property="og:title" content="Verifyistic — Waivers, Age Verification & E-Signatures for Ranges"/>
<meta property="og:description" content="Run your range front desk: digital waivers, guardian consent, check-in status cards, tamper-evident documents. Cloud or self-hosted."/>
<meta property="og:url" content="https://verifyistic.com/"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="Verifyistic — Digital Waivers for Shooting Ranges"/>
<meta name="twitter:description" content="Waivers, age verification, e-signatures and check-in. Cloud or self-hosted. From $19/mo."/>
<meta name="theme-color" content="#0b1622"/>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Verifyistic","applicationCategory":"BusinessApplication","operatingSystem":"Web, Self-Hosted","description":"Digital waivers, age verification, e-signatures and check-in for shooting ranges.","offers":[{"@type":"Offer","name":"Verifyistic Cloud — Starter","price":"19.00","priceCurrency":"USD","category":"monthly subscription"},{"@type":"Offer","name":"Verifyistic Cloud — Range","price":"49.00","priceCurrency":"USD","category":"monthly subscription"},{"@type":"Offer","name":"Verifyistic Cloud — Range Pro","price":"99.00","priceCurrency":"USD","category":"monthly subscription"},{"@type":"Offer","name":"Verifyistic Cloud — Business","price":"199.00","priceCurrency":"USD","category":"monthly subscription"}]}
</script>
<style>
:root{--bg:#0b1622;--bg2:#0e1f31;--ink:#e8f0f7;--mut:#8fa6ba;--acc:#2fbf71;--acc2:#39a7e0;--line:#1d3348}
*{box-sizing:border-box;margin:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font:17px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-x:hidden}
a{color:var(--acc2);text-decoration:none}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header{position:sticky;top:0;z-index:9;background:rgba(11,22,34,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav{display:flex;align-items:center;justify-content:space-between;height:64px}
.logo{font-weight:800;font-size:20px;letter-spacing:.3px}
.logo b{color:var(--acc)}
nav .links{display:flex;gap:22px;align-items:center;font-size:15px}
.btn{display:inline-block;padding:12px 22px;border-radius:10px;font-weight:700;transition:transform .18s,box-shadow .18s}
.btn:hover{transform:translateY(-2px)}
.btn-p{background:linear-gradient(135deg,var(--acc),#1d9e5f);color:#04140b;box-shadow:0 6px 24px rgba(47,191,113,.35)}
.btn-s{border:1px solid var(--line);color:var(--ink)}
.hero{position:relative;padding:96px 0 80px;text-align:center}
.mesh{position:absolute;inset:-40% 0 auto;height:520px;background:
 radial-gradient(600px 320px at 20% 20%,rgba(47,191,113,.16),transparent 60%),
 radial-gradient(520px 300px at 80% 30%,rgba(57,167,224,.14),transparent 60%);pointer-events:none;animation:drift 14s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate(-40px,24px) scale(1.06)}}
.kicker{display:inline-block;border:1px solid var(--line);color:var(--acc);border-radius:999px;padding:6px 14px;font-size:13px;letter-spacing:.6px;text-transform:uppercase;animation:fadeUp .7s both}
h1{font-size:clamp(34px,6vw,60px);line-height:1.08;margin:22px auto 18px;max-width:900px;animation:fadeUp .7s .1s both}
h1 em{font-style:normal;background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--mut);max-width:640px;margin:0 auto 34px;font-size:19px;animation:fadeUp .7s .2s both}
.cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;animation:fadeUp .7s .3s both}
.stats{display:flex;gap:38px;justify-content:center;margin-top:56px;flex-wrap:wrap;animation:fadeUp .7s .4s both}
.stat b{display:block;font-size:28px;color:var(--acc)}
.stat span{color:var(--mut);font-size:14px}
section{padding:84px 0;border-top:1px solid var(--line)}
h2{font-size:clamp(26px,4vw,38px);text-align:center;margin-bottom:12px}
.lead{text-align:center;color:var(--mut);max-width:620px;margin:0 auto 44px}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:26px;transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-4px);border-color:var(--acc)}
.card h3{font-size:18px;margin-bottom:8px}
.card p{color:var(--mut);font-size:15px}
.card .ico{font-size:26px;margin-bottom:10px}
.price-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));align-items:stretch}
.plan{background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:28px;text-align:center;position:relative;transition:transform .2s,border-color .2s}
.plan:hover{transform:translateY(-4px)}
.plan.hot{border-color:var(--acc);box-shadow:0 10px 40px rgba(47,191,113,.15)}
.tag{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--acc);color:#04140b;font-size:12px;font-weight:800;border-radius:999px;padding:4px 12px}
.plan .p{font-size:38px;font-weight:800;margin:10px 0 2px}
.plan .p span{font-size:15px;color:var(--mut);font-weight:500}
.plan ul{list-style:none;padding:0;margin:18px 0 22px;color:var(--mut);font-size:14.5px}
.plan li{padding:5px 0}
.plan .btn{width:100%;text-align:center}
.self{display:grid;gap:26px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:center}
.self .box{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:26px}
.big{background:linear-gradient(135deg,#10233a,#0d2033);border:1px solid var(--line);border-radius:24px;padding:64px 32px;text-align:center}
footer{border-top:1px solid var(--line);padding:34px 0;color:var(--mut);font-size:14px;text-align:center}
footer .f{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:12px}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.reveal{opacity:0;transform:translateY(22px);transition:opacity .7s,transform .7s}
.reveal.on{opacity:1;transform:none}
@media(max-width:640px){nav .links a:not(.btn){display:none}}
</style>
</head>
<body>
<header><div class="wrap"><nav>
<div class="logo">Verify<b>istic</b></div>
<div class="links">
<a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#self-hosted">Self-Hosted</a>
<a class="btn btn-p" href="https://app.verifyistic.com">Open Dashboard</a>
</div>
</nav></div></header>

<div class="hero"><div class="mesh"></div><div class="wrap">
<span class="kicker">Built for shooting ranges</span>
<h1>Waivers, age verification &amp; <em>e-signatures</em> your front desk will love</h1>
<p class="sub">Collect waivers before arrival, verify age, check customers in seconds, and keep tamper-evident signed documents — on Cloud or your own server.</p>
<div class="cta">
<a class="btn btn-p" href="#pricing">Start from $19/mo</a>
<a class="btn btn-s" href="https://api.verifyistic.com/v1/docs">Explore the API</a>
</div>
<div class="stats">
<div class="stat"><b>256-bit</b><span>signer token security</span></div>
<div class="stat"><b>SHA-256</b><span>chained audit evidence</span></div>
<div class="stat"><b>&lt;10 min</b><span>to first live waiver</span></div>
</div>
</div></div>

<section id="features"><div class="wrap">
<h2 class="reveal">Everything the front desk needs</h2>
<p class="lead reveal">Purpose-built workflows for ranges — not a generic e-sign tool.</p>
<div class="grid">
<div class="card reveal"><div class="ico">✍️</div><h3>Digital waivers</h3><p>Mobile-first signing, guardian consent for minors, drawn or typed signatures, instant branded PDFs.</p></div>
<div class="card reveal"><div class="ico">🎂</div><h3>Age verification</h3><p>Server-side DOB rules with policy thresholds, manual review flows and short-lived credentials.</p></div>
<div class="card reveal"><div class="ico">⚡</div><h3>Check-in in seconds</h3><p>Search by name, email or phone; get a full status card — waiver currency, guardian state, attention flags.</p></div>
<div class="card reveal"><div class="ico">🔗</div><h3>Tamper-evident evidence</h3><p>Every document ships with a manifest, certificate and hash-chained audit trail anyone can verify.</p></div>
<div class="card reveal"><div class="ico">🔌</div><h3>API &amp; webhooks</h3><p>REST API with OpenAPI docs, idempotency keys, HMAC-signed webhooks and a TypeScript SDK.</p></div>
<div class="card reveal"><div class="ico">🧩</div><h3>WordPress ready</h3><p>Connector plugin with site-scoped credentials, signed webhooks and WooCommerce checkout guards.</p></div>
</div>
</div></section>

<section id="pricing"><div class="wrap">
<h2 class="reveal">Simple, honest pricing</h2>
<p class="lead reveal">Per-location monthly plans — or own it forever with a perpetual self-hosted license.</p>
<div class="price-grid">
<div class="plan reveal"><h3>Starter</h3><div class="p">$19<span>/mo</span></div><ul><li>1 location</li><li>Waivers + age gates</li><li>Email delivery</li></ul><a class="btn btn-s" href="https://app.verifyistic.com">Get started</a></div>
<div class="plan hot reveal"><span class="tag">Most popular</span><h3>Range</h3><div class="p">$49<span>/mo</span></div><ul><li>Everything in Starter</li><li>Check-in + status cards</li><li>API + webhooks</li></ul><a class="btn btn-p" href="https://app.verifyistic.com">Get started</a></div>
<div class="plan reveal"><h3>Range Pro</h3><div class="p">$99<span>/mo</span></div><ul><li>Everything in Range</li><li>Kiosk + QR flows</li><li>Priority support</li></ul><a class="btn btn-s" href="https://app.verifyistic.com">Get started</a></div>
<div class="plan reveal"><h3>Business</h3><div class="p">$199<span>/mo</span></div><ul><li>Multi-site</li><li>Advanced API limits</li><li>Onboarding included</li></ul><a class="btn btn-s" href="https://app.verifyistic.com">Get started</a></div>
</div>
</div></section>

<section id="self-hosted"><div class="wrap">
<h2 class="reveal">Own your waiver system</h2>
<p class="lead reveal">One perpetual license. Unlimited local waivers. Your data never leaves your server.</p>
<div class="self">
<div class="box reveal"><h3>🏠 Range Self-Hosted — $599</h3><p style="color:var(--mut);font-size:15px">One location, unlimited local signing, branded PDFs, API &amp; webhooks, local or S3 storage. 12 months of updates included.</p></div>
<div class="box reveal"><h3>🏢 Multi-Location — $1,499</h3><p style="color:var(--mut);font-size:15px">Centralized deployment across locations with multi-site branding and admin roles.</p></div>
<div class="box reveal"><h3>🔄 Updates &amp; Support — $149/yr</h3><p style="color:var(--mut);font-size:15px">Continue getting new features, security updates and support after your included year.</p></div>
</div>
</div></section>

<section><div class="wrap"><div class="big reveal">
<h2>Ready in minutes, trusted for years</h2>
<p class="lead">Create your first template, send a waiver, and check a customer in before your coffee cools.</p>
<a class="btn btn-p" href="https://app.verifyistic.com">Create your account</a>
&nbsp;<a class="btn btn-s" href="https://api.verifyistic.com/v1/docs">Read the API docs</a>
</div></div></section>

<footer><div class="wrap">
<div class="f"><a href="https://api.verifyistic.com/v1/docs">API Docs</a><a href="https://api.verifyistic.com/v1/openapi.json">OpenAPI</a><a href="#pricing">Pricing</a><a href="https://app.verifyistic.com">Dashboard</a></div>
© Verifyistic · Digital waivers, age verification &amp; e-signatures. Verifyistic provides evidence tooling, not legal advice.
</div></footer>

<script>
(function(){
 var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("on");io.unobserve(e.target);}});},{threshold:.12});
 document.querySelectorAll(".reveal").forEach(function(el){io.observe(el);});
})();
</script>
</body>
</html>`;

export default {
	async fetch() {
		return new Response(HTML, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "public, max-age=300",
			},
		});
	},
};
