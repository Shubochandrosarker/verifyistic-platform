/**
 * Hosted signer page (doc 07 §4 UX, doc 19 §5) — Phase 4 functional MVP.
 * Mobile-first, no third-party scripts, no tracking; polish/accessibility pass lands
 * with the dedicated signer app. Served at /s/{token} with strict no-referrer.
 * SECURITY NOTE: inline script requires 'unsafe-inline' in dev CSP — the production
 * signer app will ship a hashed/bundled build with a strict CSP.
 */
export function signerPageHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign document</title>
<style>
  :root { --ink:#17202a; --line:#d7dde3; --accent:#0b5cad; --ok:#1b7f4d; --err:#b3261e; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:#f4f6f8; }
  main { max-width:640px; margin:0 auto; padding:16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:14px; }
  h1 { font-size:1.25rem; margin:0 0 4px; }
  .muted { color:#5c6771; font-size:.9rem; }
  label { display:block; font-weight:600; margin:12px 0 4px; }
  input[type=text],input[type=email],input[type=tel],input[type=date],select {
    width:100%; padding:12px; border:1px solid var(--line); border-radius:8px; font-size:1rem; background:#fff;
  }
  .check { display:flex; gap:10px; align-items:flex-start; margin:12px 0; }
  .check input { width:22px; height:22px; margin-top:2px; }
  canvas { width:100%; height:160px; border:1px dashed var(--line); border-radius:8px; touch-action:none; background:#fff; }
  .toggle { display:flex; gap:8px; margin:8px 0; }
  .toggle button { flex:1; padding:10px; border:1px solid var(--line); border-radius:8px; background:#fff; font-size:.95rem; cursor:pointer; }
  .toggle button[aria-pressed=true] { background:var(--accent); color:#fff; border-color:var(--accent); }
  .btn { display:block; width:100%; padding:15px; margin-top:14px; border:0; border-radius:10px; background:var(--accent); color:#fff; font-size:1.05rem; font-weight:700; cursor:pointer; }
  .btn.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); margin-top:8px; }
  .err { color:var(--err); font-size:.9rem; margin:6px 0; }
  .hidden { display:none; }
  .receipt { text-align:center; }
  .receipt .ok { font-size:2rem; }
  footer { text-align:center; color:#8a949d; font-size:.78rem; padding:10px 0 24px; }
</style>
</head>
<body>
<main id="app"><div class="card"><h1>Loading…</h1></div></main>
<footer>Secured by Verifyistic · Electronic signature consent applies to this document</footer>
<script>
(function () {
  "use strict";
  var token = location.pathname.split("/").pop();
  var app = document.getElementById("app");
  var view = null;
  var values = {};
  var mode = "typed";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }

  fetch("/v1/sign/" + encodeURIComponent(token) + "/session")
    .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { renderError(res.body && res.body.error ? res.body.error.message : "This link is not usable."); return; }
      view = res.body.data;
      if (view.status === "processing" || view.status === "completed") { renderReceipt(); return; }
      renderForm();
    })
    .catch(function () { renderError("Network error. Please try again."); });

  function renderError(message) {
    app.innerHTML = '<div class="card"><h1>Link unavailable</h1><p class="muted">' + esc(message) + '</p></div>';
  }

  function renderReceipt() {
    app.innerHTML = '<div class="card receipt"><div class="ok">✅</div><h1>Document signed</h1>' +
      '<p class="muted">Your signed document was submitted' + (view ? ' to ' + esc(view.business_name) : '') +
      '. You will receive a copy according to the business\u2019 delivery settings.</p>' +
      '<p class="muted">Session: ' + esc(view ? view.session_id : "") + '</p></div>';
  }

  function blockHtml(b) {
    if (b.type === "heading") return "<h1>" + esc(b.text) + "</h1>";
    if (b.type === "paragraph") return "<p>" + esc(b.text) + "</p>";
    if (b.type === "participant") return "";
    if (b.type === "field") {
      var id = "f_" + b.field_key;
      if (b.field_type === "checkbox")
        return '<div class="check"><input type="checkbox" id="' + id + '" data-key="' + esc(b.field_key) + '"' + (values[b.field_key] === true ? " checked" : "") + ' /><label for="' + id + '" style="margin:0;font-weight:500">' + esc(b.label) + '</label></div>';
      if (b.field_type === "radio" || b.field_type === "select") {
        var opts = (b.options || []).map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join("");
        return '<label for="' + id + '">' + esc(b.label) + '</label><select id="' + id + '" data-key="' + esc(b.field_key) + '"><option value="">Choose…</option>' + opts + '</select>';
      }
      var type = b.field_type === "email" ? "email" : b.field_type === "phone" ? "tel" : b.field_type === "dob" ? "date" : "text";
      return '<label for="' + id + '">' + esc(b.label) + '</label><input type="' + type + '" id="' + id + '" data-key="' + esc(b.field_key) + '" value="' + esc(values[b.field_key] || "") + '" />';
    }
    if (b.type === "initials" || b.type === "signature") {
      var cid = "f_" + b.field_key;
      return '<div class="check"><input type="checkbox" id="' + cid + '" data-key="' + esc(b.field_key) + '"' + (values[b.field_key] === true ? " checked" : "") + ' /><label for="' + cid + '" style="margin:0;font-weight:500">' + esc(b.label) + '</label></div>';
    }
    return "";
  }

  function conditionalVisible(b) {
    return values[b.if.field] === b.if.equals;
  }

  function renderForm() {
    var parts = [];
    parts.push('<div class="card"><h1>' + esc(view.template_title) + '</h1>' +
      '<p class="muted">' + esc(view.business_name) + ' · version ' + esc(view.template_version) + '</p></div>');
    var condIndex = 0;
    for (var i = 0; i < view.schema.blocks.length; i++) {
      var b = view.schema.blocks[i];
      if (b.type === "conditional") {
        condIndex++;
        parts.push('<div class="card cond" data-cond="' + condIndex + '">' + b.blocks.map(blockHtml).join("") + '</div>');
      } else if (b.type !== "signature") {
        parts.push(b.type === "heading" || b.type === "paragraph"
          ? '<div class="card">' + blockHtml(b) + '</div>'
          : '<div class="card">' + blockHtml(b) + '</div>');
      }
    }
    var hasGuardian = view.participants.some(function (p) { return p.role === "guardian"; });
    parts.push('<div class="card"><h1>Consent & signature</h1>' +
      '<p class="muted">By signing electronically, I agree to conduct this transaction electronically (consent ' + esc(view.consent_text_version) + ').</p>' +
      '<div class="check"><input type="checkbox" id="consent" /><label for="consent" style="margin:0;font-weight:500">I have read the document and consent to sign it electronically.</label></div>' +
      '<div class="err hidden" id="consent-err">You must accept the electronic signature consent to sign.</div>' +
      '<div class="toggle"><button type="button" id="m-typed" aria-pressed="true">Type name</button><button type="button" id="m-drawn" aria-pressed="false">Draw</button></div>' +
      '<div id="typed-wrap"><label for="typed">Full legal name' + (hasGuardian ? ' (guardian signs below)' : '') + '</label><input type="text" id="typed" placeholder="' + (hasGuardian ? 'Guardian legal name' : 'Your legal name') + '" /></div>' +
      '<div id="drawn-wrap" class="hidden"><canvas id="pad" width="600" height="200"></canvas><button type="button" class="btn secondary" id="clear">Clear</button></div>' +
      '<button type="button" class="btn" id="sign">Agree & Sign</button>' +
      '<div class="err hidden" id="form-err"></div>' +
      '<button type="button" class="btn secondary" id="decline">I do not agree (decline)</button>' +
      '</div>');
    app.innerHTML = parts.join("");
    wire();
  }

  var lastProgress = 0;
  function pushProgress() {
    var now = Date.now();
    if (now - lastProgress < 3000) return;
    lastProgress = now;
    fetch("/v1/sign/" + encodeURIComponent(token) + "/progress", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: values })
    }).catch(function () {});
  }

  function wire() {
    document.querySelectorAll("[data-key]").forEach(function (el) {
      var key = el.getAttribute("data-key");
      var handler = function () {
        values[key] = el.type === "checkbox" ? el.checked : (el.value === "" ? null : el.value);
        document.querySelectorAll(".cond").forEach(function (card) {
          var idx = Number(card.getAttribute("data-cond")) - 1;
          var condBlocks = [];
          for (var j = 0; j < view.schema.blocks.length; j++) if (view.schema.blocks[j].type === "conditional") condBlocks.push(view.schema.blocks[j]);
          card.classList.toggle("hidden", !conditionalVisible(condBlocks[idx]));
        });
        pushProgress();
      };
      el.addEventListener("change", handler);
      el.addEventListener("input", handler);
      handler();
    });

    var pad = document.getElementById("pad"), ctx = pad ? pad.getContext("2d") : null;
    var drawing = false;
    function pos(e) { var r = pad.getBoundingClientRect(); var t = e.touches ? e.touches[0] : e; return [ (t.clientX - r.left) * (pad.width / r.width), (t.clientY - r.top) * (pad.height / r.height) ]; }
    if (pad) {
      ["mousedown","touchstart"].forEach(function (ev) { pad.addEventListener(ev, function (e) { e.preventDefault(); drawing = true; ctx.beginPath(); ctx.moveTo.apply(ctx, pos(e)); }, { passive: false }); });
      ["mousemove","touchmove"].forEach(function (ev) { pad.addEventListener(ev, function (e) { if (!drawing) return; e.preventDefault(); ctx.lineTo.apply(ctx, pos(e)); ctx.stroke(); }, { passive: false }); });
      ["mouseup","touchend","mouseleave"].forEach(function (ev) { pad.addEventListener(ev, function () { drawing = false; }); });
      document.getElementById("clear").addEventListener("click", function () { ctx.clearRect(0, 0, pad.width, pad.height); });
    }
    function setMode(m) {
      mode = m;
      document.getElementById("m-typed").setAttribute("aria-pressed", String(m === "typed"));
      document.getElementById("m-drawn").setAttribute("aria-pressed", String(m === "drawn"));
      document.getElementById("typed-wrap").classList.toggle("hidden", m !== "typed");
      document.getElementById("drawn-wrap").classList.toggle("hidden", m !== "drawn");
    }
    document.getElementById("m-typed").addEventListener("click", function () { setMode("typed"); });
    document.getElementById("m-drawn").addEventListener("click", function () { setMode("drawn"); });

    document.getElementById("sign").addEventListener("click", function () {
      var consent = document.getElementById("consent").checked;
      document.getElementById("consent-err").classList.toggle("hidden", consent);
      if (!consent) return;
      var signatures = [{ role: "signer", method: mode === "typed" ? "typed" : "drawn" }];
      if (mode === "typed") signatures[0].typed_name = document.getElementById("typed").value;
      else signatures[0].artifact = pad.toDataURL("image/png");
      if (view.participants.some(function (p) { return p.role === "guardian"; })) {
        signatures.push(JSON.parse(JSON.stringify(signatures[0])));
        signatures[1].role = "guardian";
      }
      fetch("/v1/sign/" + encodeURIComponent(token) + "/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: values, consent: { accepted: consent }, signatures: signatures })
      }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (!res.ok) {
            var msg = res.body && res.body.error ? res.body.error.message : "Could not submit.";
            if (res.body && res.body.error && res.body.error.fields) {
              msg += " " + Object.keys(res.body.error.fields).map(function (k) { return k + ": " + res.body.error.fields[k].join(" "); }).join(" · ");
            }
            var fe = document.getElementById("form-err");
            fe.textContent = msg; fe.classList.remove("hidden");
            return;
          }
          view = view || {}; renderReceipt();
        }).catch(function () { renderError("Network error. Please try again."); });
    });

    document.getElementById("decline").addEventListener("click", function () {
      if (!window.confirm("Decline to sign this document?")) return;
      fetch("/v1/sign/" + encodeURIComponent(token) + "/decline", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
      }).then(function () { renderError("You declined to sign. No document was created."); });
    });
  }
})();
</script>
`;
}
