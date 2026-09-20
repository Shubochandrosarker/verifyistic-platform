/**
 * Verifyistic Dashboard (app.verifyistic.com) — vanilla SPA over the v1 API.
 * Auth: user's API key (vfy_live_/vfy_test_) stored in localStorage. No PII in code.
 */
const API = "https://api.verifyistic.com/v1";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Verifyistic Dashboard</title>
<meta name="robots" content="noindex"/>
<style>
:root{--bg:#0b1622;--bg2:#0e1f31;--ink:#e8f0f7;--mut:#8fa6ba;--acc:#2fbf71;--acc2:#39a7e0;--line:#1d3348;--err:#e05252}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif}
button{font:inherit;cursor:pointer}
.topbar{display:flex;align-items:center;gap:16px;padding:0 22px;height:58px;background:var(--bg2);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.logo{font-weight:800;font-size:18px}.logo b{color:var(--acc)}
.topbar .sp{flex:1}
.topbar .who{color:var(--mut);font-size:13px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn{border:0;border-radius:8px;padding:9px 16px;font-weight:700;background:var(--acc);color:#04140b}
.btn:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--ink);font-weight:500}
.btn.danger{background:transparent;border:1px solid var(--err);color:var(--err)}
.layout{display:flex;min-height:calc(100vh - 58px)}
.side{width:200px;border-right:1px solid var(--line);padding:18px 10px;display:flex;flex-direction:column;gap:4px}
.side button{background:none;border:0;color:var(--mut);text-align:left;padding:10px 14px;border-radius:8px;font-weight:600}
.side button.on,.side button:hover{background:var(--bg2);color:var(--ink)}
main{flex:1;padding:26px 30px;max-width:1050px}
h1{font-size:22px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--mut);text-align:left;font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid #14273a;overflow:hidden;text-overflow:ellipsis;max-width:230px;white-space:nowrap}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
.pill.g{background:rgba(47,191,113,.15);color:var(--acc)}
.pill.b{background:rgba(57,167,224,.15);color:var(--acc2)}
.pill.r{background:rgba(224,82,82,.15);color:var(--err)}
.pill.y{background:rgba(240,200,80,.15);color:#e8c860}
input,select{background:var(--bg2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px 12px;font:inherit;width:100%}
form{display:grid;gap:12px;grid-template-columns:1fr 1fr;margin:14px 0 8px}
form .full{grid-column:1/-1}
label{font-size:12.5px;color:var(--mut);display:block;margin-bottom:4px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:13px}
.muted{color:var(--mut)}
#toast{position:fixed;bottom:22px;right:22px;background:var(--bg2);border:1px solid var(--line);border-left:4px solid var(--acc);padding:12px 18px;border-radius:8px;display:none;max-width:380px;z-index:20}
#toast.err{border-left-color:var(--err)}
.login{max-width:420px;margin:12vh auto;padding:34px;background:var(--bg2);border:1px solid var(--line);border-radius:16px}
.login h1{font-size:20px}.login .logo{font-size:22px;margin-bottom:14px}
.sec{display:none}.sec.on{display:block}
.keyrow{display:flex;gap:8px;align-items:center}
</style>
</head>
<body>
<div id="login" class="login">
<div class="logo">Verify<b>istic</b></div>
<h1>Sign in to your dashboard</h1>
<p class="muted" style="margin:8px 0 16px">Paste a Verifyistic API key (<span class="mono">vfy_live_…</span>). It stays in this browser and is sent only to the Verifyistic API.</p>
<label for="key">Company / range name</label>
<input id="su_co" placeholder="Acme Range"/>
<div style="margin-top:10px"><label for="su_em">Email</label><input id="su_em" type="email" placeholder="you@range.com"/></div>
<div style="margin-top:10px"><label for="su_pw">Password (10+ chars)</label><input id="su_pw" type="password"/></div>
<button class="btn" style="width:100%;margin-top:14px" onclick="signup()">Create account</button>
<p class="muted" style="text-align:center;margin:10px 0">Already have an account? <a href="#" id="toggle-login" style="color:var(--acc2)">Sign in</a></p>
<div id="login-fields" style="display:none">
<div style="margin-top:8px"><label for="li_em">Email</label><input id="li_em" type="email"/></div>
<div style="margin-top:10px"><label for="li_pw">Password</label><input id="li_pw" type="password"/></div>
<button class="btn" style="width:100%;margin-top:14px" onclick="login()">Sign in</button>
<p class="muted" style="text-align:center;margin:10px 0"><a href="#" id="toggle-signup" style="color:var(--acc2)">Create an account</a> · <a href="#" id="toggle-key" style="color:var(--acc2)">Use an API key</a></p>
</div>
<p id="lerr" class="muted" style="margin-top:12px;color:var(--err);display:none"></p>
</div>

<div id="app" style="display:none">
<div class="topbar"><span class="logo">Verify<b>istic</b></span><span class="who" id="who"></span><span class="sp"></span><button class="btn ghost" onclick="signout()">Sign out</button></div>
<div class="layout">
<div class="side" id="nav"></div>
<main id="main"></main>
</div>
</div>
<div id="toast"></div>

<script>
const API = "https://api.verifyistic.com/v1";
(function(){"use strict";
var KEY=localStorage.getItem("vfy_key")||"",ORG=null;
var PRICES={cloud_starter:"pri_01m2xsd262rezepyztce1xp8dc",cloud_range:"pri_01m2xsd29s4xha041jffh2ytgz",cloud_range_pro:"pri_01m2xsd2dtd7d9v90537425ent",cloud_business:"pri_01m2xsd2gn7q813afq1e283wz8",self_hosted_range:"pri_01m2xsd2n0rz24dnbt7192n769",self_hosted_pro:"pri_01m2xsd2r6n08rmk0ka9r6kyam",self_hosted_multi:"pri_01m2xsd2v57qhde8575ez4jw87",updates_support:"pri_01m2xsd2yr5040y9cqz14ybszp"};
var PLAN=new URLSearchParams(location.hash.slice(1)).get("plan")||null;
var __VFY_PADDLE_CLIENT_TOKEN__="";
var PADDLE_CLIENT_TOKEN=__VFY_PADDLE_CLIENT_TOKEN__||"";
var NAV=[
["overview","Overview"],["billing","Billing & Plans"],["customers","Customers"],["templates","Templates"],
["sessions","Signing Requests"],["documents","Documents"],["keys","API Keys"],["webhooks","Webhooks"]];
window.__api=function(m,p,b){return fetch(API+p,{method:m,headers:{"Authorization":"Bearer "+KEY,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok||j.error){var e=new Error((j.error&&j.error.message)||("HTTP "+r.status));e.code=j.error&&j.error.code;e.status=r.status;throw e;}return j;});});};
function toast(m,err){var t=document.getElementById("toast");t.textContent=m;t.className=err?"err":"";t.style.display="block";setTimeout(function(){t.style.display="none";},4200);}
window.signout=function(){localStorage.removeItem("vfy_key");KEY="";location.reload();};
function v2(id){var el=document.getElementById(id);return el?el.value.trim():"";}
function saveKey(k){KEY=k;localStorage.setItem("vfy_key",k);__api("GET","/organization").then(function(j){ORG=j.data;boot();}).catch(function(e){showErr(e.message);});}
window.signup=function(){var co=v2("su_co"),em=v2("su_em"),pw=v2("su_pw");
if(!co||!em||pw.length<10){return showErr("Fill company, email and a 10+ character password.");}
fetch(API+"/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company_name:co,email:em,password:pw})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(res){
if(!res.ok){return showErr((res.j.error&&res.j.error.message)||"Signup failed");}
if(PLAN){sessionStorage.setItem("vfy_pending_plan",PLAN);}
saveKey(res.j.data.api_key);}).catch(function(){showErr("Network error.");});};
window.login=function(){__api("POST","/auth/login",{email:v2("li_em"),password:v2("li_pw")}).then(function(j){saveKey(j.data.api_key);}).catch(function(e){showErr(e.message);});};
document.addEventListener("click",function(ev){var t=ev.target.id||"";
if(t==="toggle-login"){ev.preventDefault();document.getElementById("su_co").style.display="none";document.querySelectorAll("#su_em,#su_pw").forEach(function(e){e.parentElement.style.display="block";});
document.getElementById("login-fields").style.display="block";document.getElementById("su_co").parentElement.style.display="none";document.querySelector('button[onclick="signup()"]').style.display="none";}
if(t==="toggle-signup"){ev.preventDefault();location.reload();}
if(t==="toggle-key"){ev.preventDefault();location.hash="";location.reload();}});
function showErr(m){var el=document.getElementById("lerr");el.textContent=m;el.style.display="block";}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function pill(v,cls){return '<span class="pill '+cls+'">'+esc(v)+"</span>";}
function stPill(s){var m={completed:["completed","g"],active:["active","g"],current:["current","g"],published:["published","g"],canceled:["canceled","r"],declined:["declined","r"],revoked:["revoked","r"],void:["void","r"],voided:["void","r"],processing:["processing","y"],expired:["expired","y"],past_due:["past due","y"],draft:["draft","b"],sent:["sent","b"],viewed:["viewed","b"],in_progress:["in progress","y"]};
var f=m[s]||[s,"b"];return pill(f[0],f[1]);}
function boot(){
document.getElementById("login").style.display="none";
document.getElementById("app").style.display="block";
document.getElementById("who").textContent=ORG.name+" · "+ORG.slug;
var nav=document.getElementById("nav");nav.innerHTML="";
NAV.forEach(function(n){var b=document.createElement("button");b.textContent=n[1];b.id="nav_"+n[0];b.onclick=function(){go(n[0]);};nav.appendChild(b);});
if(PLAN){sessionStorage.setItem("vfy_pending_plan",PLAN);}
go(sessionStorage.getItem("vfy_pending_plan")?"billing":"overview");
}
window.go=function(sec){document.querySelectorAll(".sec").forEach(function(s){s.classList.remove("on");});document.querySelectorAll("#nav button").forEach(function(b){b.classList.remove("on");});
var nb=document.getElementById("nav_"+sec);if(nb)nb.classList.add("on");
var m=document.getElementById("main");m.innerHTML='<h1>'+NAV.find(function(n){return n[0]===sec;})[1]+'</h1><div id="body_'+sec+'" class="sec on"><p class="muted">Loading…</p></div>';
var R={overview:vOverview,billing:vBilling,customers:vCustomers,templates:vTemplates,sessions:vSessions,documents:vDocuments,keys:vKeys,webhooks:vWebhooks}[sec]||vOverview;
var pending=sessionStorage.getItem("vfy_pending_plan");R().then(function(){if(pending&&sec==="billing"){sessionStorage.removeItem("vfy_pending_plan");setTimeout(function(){window.upgrade(pending);},400);}}).catch(function(e){document.getElementById("body_"+sec).innerHTML='<p style="color:var(--err)">'+esc(e.message)+"</p>";});};
function head(extra){return '<div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:14px">'+(extra||"")+"</div>";}
function tbl(id,cols){return '<table id="'+id+'"><thead><tr>'+cols.map(function(c){return "<th>"+esc(c)+"</th>";}).join("")+"</tr></thead><tbody></tbody></table>";}
function rows(id,data){var b=document.querySelector("#"+id+" tbody");b.innerHTML=data;}
function tm(s){return s?new Date(s).toLocaleDateString()+" "+new Date(s).toLocaleTimeString():"—";}

function loadPaddle(cb){if(window.Paddle&&window.Paddle.Initialized){return cb();}
var sc=document.createElement("script");sc.src="https://cdn.paddle.com/paddle/v2/paddle.js";
sc.onload=function(){try{Paddle.Environment.set("live");Paddle.Initialize({token:PADDLE_CLIENT_TOKEN,checkout:{settings:{displayMode:"overlay"}}});cb();}catch(e){toast("Checkout could not initialize. Please try again.",true);}};
sc.onerror=function(){toast("Checkout unavailable — Paddle failed to load.",true);};
document.head.appendChild(sc);}
window.upgrade=function(plan){var priceId=PRICES[plan];if(!priceId||!PADDLE_CLIENT_TOKEN){return toast("Checkout unavailable — client token missing.",true);}
loadPaddle(function(){try{Paddle.Checkout.open({items:[{priceId:priceId,quantity:1}],settings:{displayMode:"overlay"},customer:(ORG&&ORG.billing_email)?{email:ORG.billing_email}:undefined,customData:{organization_id:ORG.id,plan:plan}});}catch(e){toast("Checkout could not open. Please try again.",true);}});
var tries=0;var iv=setInterval(function(){tries++;__api("GET","/entitlements").then(function(j){
var hit=(j.data||[]).some(function(e){return e.plan===plan&&e.status==="active";});
if(hit){clearInterval(iv);toast("Plan active: "+plan);go("billing");}});if(tries>40){clearInterval(iv);}},4000);};
function vBilling(){return __api("GET","/entitlements").then(function(ent){
var active={};(ent.data||[]).forEach(function(e){active[e.plan]=e.status;});
var plans=[["cloud_starter","Starter","$19/mo"],["cloud_range","Range","$49/mo"],["cloud_range_pro","Range Pro","$99/mo"],["cloud_business","Business","$199/mo"],["self_hosted_range","Self-Hosted Range","$599 once"],["self_hosted_pro","Self-Hosted Pro","$999 once"],["self_hosted_multi","Multi-Location","$1,499 once"],["updates_support","Updates & Support","$149/yr"]];
document.getElementById("body_billing").innerHTML="<p class='muted' style='margin-bottom:14px'>Pick a plan — checkout opens in a popup. Entitlements activate automatically after payment.</p>"+
plans.map(function(p){var isA=active[p[0]]==="active";
return "<div class='card' style='margin-bottom:12px;display:flex;justify-content:space-between;align-items:center'><div><b>"+esc(p[1])+"</b> <span class='muted'>"+esc(p[2])+"</span></div>"+
(isA?pill("active","g"):"<button class='btn' onclick=\\\"upgrade('"+p[0]+"')\\\">Checkout</button>")+"</div>";}).join("");});}
function vOverview(){return Promise.all([__api("GET","/customers?limit=1"),__api("GET","/templates"),__api("GET","/signing-sessions"),__api("GET","/documents")]).then(function(r){
var cust=r[0].meta,custHasMore=cust&&cust.has_more;var docs=r[3].data||[];
document.getElementById("body_overview").innerHTML=
'<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'+
stat("Customers",(custHasMore?"100+":"0"+(r[0].data?r[0].data.length:"")))+
stat("Templates",String((r[1].data||[]).length))+
stat("Signing requests",String((r[2].data||[]).length))+
stat("Documents",String(docs.length))+"</div>"+
"<h1 style='margin-top:30px;font-size:18px'>Recent documents</h1>"+tbl("ov_docs",["Number","Status","Signed"])+
"<p class='muted' style='margin-top:14px'>Organization: <b>"+esc(ORG.name)+"</b> · slug "+esc(ORG.slug)+" · "+esc(ORG.timezone)+"</p>";
rows("ov_docs",docs.slice(0,6).map(function(d){return "<tr><td class='mono'>"+esc(d.document_number)+"</td><td>"+stPill(d.status)+"</td><td>"+tm(d.signed_at)+"</td></tr>";}));});}
function stat(l,v){return "<div class='card'><p class='muted' style='font-size:13px'>"+l+"</p><p style='font-size:30px;font-weight:800'>"+esc(v)+"</p></div>";}

function vCustomers(){return __api("GET","/customers?limit=100").then(function(j){
var h=head('<button class="btn" onclick="newCustomer()">+ New customer</button>')+
'<form id="cf" style="display:none">'+
'<div><label>First name</label><input id="c_fn"/></div><div><label>Last name</label><input id="c_ln"/></div>'+
'<div><label>Email</label><input id="c_em" type="email"/></div><div><label>Phone</label><input id="c_ph"/></div>'+
'<div class="full"><button class="btn" type="button" onclick="saveCustomer()">Save customer</button> <button class="btn ghost" type="button" onclick="document.getElementById(\\'cf\\').style.display=\\'none\\'">Cancel</button></div></form>'+
tbl("ct",["Name","Email","Phone","Status","Created"]);
document.getElementById("body_customers").innerHTML=h;rows("ct",(j.data||[]).map(function(c){return "<tr><td>"+esc(c.first_name+" "+c.last_name)+"</td><td>"+esc(c.email||"—")+"</td><td>"+esc(c.phone||"—")+"</td><td>"+stPill(c.status)+"</td><td>"+tm(c.created_at)+"</td></tr>";}));});}
window.newCustomer=function(){document.getElementById("cf").style.display="grid";};
window.saveCustomer=function(){__api("POST","/customers",{first_name:v("c_fn"),last_name:v("c_ln"),email:v("c_em")||null,phone:v("c_ph")||null},{key:true}).then(function(){toast("Customer saved");go("customers");}).catch(function(e){toast(e.message,true);});};
function v(id){return document.getElementById(id).value.trim();}

function vTemplates(){return __api("GET","/templates").then(function(j){
document.getElementById("body_templates").innerHTML=head("")+tbl("tp",["Name","Category","Status","Current version"]);
rows("tp",(j.data||[]).map(function(t){return "<tr><td>"+esc(t.name)+"</td><td>"+esc(t.category)+"</td><td>"+stPill(t.status)+"</td><td class='mono'>"+esc((t.current_version_id||"—").slice(0,8)+"…")+"</td></tr>";}));});}

function vSessions(){return Promise.all([__api("GET","/signing-sessions"),__api("GET","/templates"),__api("GET","/customers")]).then(function(r){
var tpls=(r[1].data||[]).filter(function(t){return t.status==="published";});
var custs=r[2].data||[];
var opts=tpls.map(function(t){return "<option value='"+esc(t.id)+"'>"+esc(t.name)+"</option>";}).join("");
var copts=custs.map(function(c){return "<option value='"+esc(c.id)+"'>"+esc(c.first_name+" "+c.last_name)+"</option>";}).join("");
document.getElementById("body_sessions").innerHTML=head('<button class="btn" onclick="document.getElementById(\\'sf\\').style.display=\\'grid\\'">+ New signing request</button>')+
'<form id="sf" style="display:none"><div><label>Template (published)</label><select id="s_tpl">'+opts+'</select></div>'+
'<div><label>Customer</label><select id="s_cust">'+copts+'</select></div>'+
'<div class="full"><button class="btn" type="button" onclick="createSession()">Create request</button> <button class="btn ghost" type="button" onclick="document.getElementById(\\'sf\\').style.display=\\'none\\'">Cancel</button></div></form>'+
tbl("ss",["Status","Customer","Expires","Created"]);
window.__custs=custs;
rows("ss",(r[0].data||[]).map(function(s){var c=window.__custs.find(function(x){return x.id===s.customer_id;});
return "<tr><td>"+stPill(s.status)+"</td><td>"+esc(c?c.first_name+" "+c.last_name:s.customer_id.slice(0,8)+"…")+"</td><td>"+tm(s.expires_at)+"</td><td>"+tm(s.created_at)+"</td></tr>";}));});}
window.createSession=function(){__api("POST","/signing-sessions",{template_id:v("s_tpl"),customer_id:v("s_cust"),delivery_method:"email"}).then(function(j){toast("Request created — signer link copied to a prompt now");var w=window.open("","_blank");w.document.write("<p style='font-family:sans-serif;padding:30px'>Signer link (send to the customer):<br><br><a href='"+j.data.signer_url+"'>"+j.data.signer_url+"</a><br><br>Or open it directly — this browser is authorized for this demo link.</p>");go("sessions");}).catch(function(e){toast(e.message,true);});};

function vDocuments(){return __api("GET","/documents").then(function(j){
document.getElementById("body_documents").innerHTML=head("")+tbl("dc",["Number","Status","Signed","Actions"]);
rows("dc",(j.data||[]).map(function(d){return "<tr><td class='mono'>"+esc(d.document_number)+"</td><td>"+stPill(d.status)+"</td><td>"+tm(d.signed_at)+"</td><td><button class='btn ghost' style='padding:4px 10px;font-size:13px' onclick=&quot;dlDoc('"+esc(d.id)+"')&quot;>Download</button></td></tr>";}));});}
window.dlDoc=function(id){__api("POST","/documents/"+id+"/download-token").then(function(j){location.href=j.data.download_url;}).catch(function(e){toast(e.message,true);});};

function vKeys(){return __api("GET","/api-keys").then(function(j){
document.getElementById("body_keys").innerHTML=head('<button class="btn" onclick="document.getElementById(\\'kf\\').style.display=\\'grid\\'">+ New API key</button>')+
'<form id="kf" style="display:none"><div><label>Name</label><input id="k_nm" placeholder="integration-name"/></div>'+
'<div><label>Mode</label><select id="k_md"><option value="live">live</option><option value="test">test</option></select></div>'+
'<div class="full"><label>Scopes (comma-separated)</label><input id="k_sc" value="customers:read,signing:write,documents:read"/>'+
'<button class="btn" style="margin-top:10px" type="button" onclick="createKey()">Create key</button> <button class="btn ghost" type="button" onclick="document.getElementById(\\'kf\\').style.display=\\'none\\'">Cancel</button></div></form>'+
'<div id="newkey" class="card" style="display:none;margin-bottom:14px"><b style="color:var(--acc)">Copy your key now — it is shown only once:</b><p class="mono" id="nk" style="margin:8px 0;word-break:break-all"></p></div>'+
tbl("ak",["Name","Prefix","Mode","Scopes","Last used","Actions"]);
rows("ak",(j.data||[]).map(function(k){return "<tr><td>"+esc(k.name)+"</td><td class='mono'>"+esc(k.key_prefix)+"…</td><td>"+(k.key_prefix.indexOf("_test_")>=0?pill("test","b"):pill("live","g"))+"</td><td class='muted'>"+esc((k.scopes||[]).join(", "))+"</td><td>"+tm(k.last_used_at)+"</td><td><button class='btn danger' style='padding:4px 10px;font-size:13px' onclick=&quot;revokeKey('"+esc(k.id)+"')&quot;>Revoke</button></td></tr>";}));});}
window.createKey=function(){var scopes=v("k_sc").split(",").map(function(s){return s.trim();}).filter(Boolean);
__api("POST","/api-keys",{name:v("k_nm"),mode:v("k_md"),scopes:scopes}).then(function(j){document.getElementById("kf").style.display="none";
document.getElementById("newkey").style.display="block";document.getElementById("nk").textContent=j.data.key;toast("API key created");go("keys");}).catch(function(e){toast(e.message,true);});};
window.revokeKey=function(id){if(!confirm("Revoke this API key? Clients using it stop working immediately."))return;__api("DELETE","/api-keys/"+id).then(function(){toast("Key revoked");go("keys");}).catch(function(e){toast(e.message,true);});};

function vWebhooks(){return __api("GET","/webhooks").then(function(j){
document.getElementById("body_webhooks").innerHTML=head('<button class="btn" onclick="document.getElementById(\\'wf\\').style.display=\\'grid\\'">+ Register endpoint</button>')+
'<form id="wf" style="display:none"><div class="full"><label>Endpoint URL (https)</label><input id="w_url" placeholder="https://example.com/verifyistic"/></div>'+
'<div class="full"><label>Events (comma-separated, * for all)</label><input id="w_ev" value="*"/>'+
'<button class="btn" style="margin-top:10px" type="button" onclick="registerHook()">Register</button> <button class="btn ghost" type="button" onclick="document.getElementById(\\'wf\\').style.display=\\'none\\'">Cancel</button></div></form>'+
'<div id="whsec" class="card" style="display:none;margin-bottom:14px"><b style="color:var(--acc)">Signing secret — shown only once:</b><p class="mono" id="whs" style="margin:8px 0;word-break:break-all"></p></div>'+
tbl("wk",["URL","Events","Status"]);
rows("wk",(j.data||[]).map(function(w){return "<tr><td class='mono'>"+esc(w.url)+"</td><td class='muted'>"+esc((w.subscribed_events||[]).join(", "))+"</td><td>"+stPill(w.status)+"</td></tr>";}));});}
window.registerHook=function(){__api("POST","/webhooks",{url:v("w_url"),events:v("w_ev").split(",").map(function(s){return s.trim();})}).then(function(j){document.getElementById("wf").style.display="none";
document.getElementById("whsec").style.display="block";document.getElementById("whs").textContent=j.data.secret;toast("Endpoint registered");go("webhooks");}).catch(function(e){toast(e.message,true);});};

if(KEY){__api("GET","/organization").then(function(j){ORG=j.data;boot();}).catch(function(){localStorage.removeItem("vfy_key");});}
})();
</script>
</body>
</html>`;

const SECURITY_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"X-Frame-Options": "DENY",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Content-Security-Policy":
		"default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://cdn.paddle.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.verifyistic.com https://cdn.paddle.com https://*.paddle.com; frame-src https://*.paddle.com; font-src 'self' data:; object-src 'none'",
};

export default {
	async fetch(_request, env) {
		const token = JSON.stringify(env.PADDLE_CLIENT_TOKEN ?? "").replace(
			/</g,
			"\\u003c",
		);
		const page = PAGE.replace(
			'var __VFY_PADDLE_CLIENT_TOKEN__="";',
			`var __VFY_PADDLE_CLIENT_TOKEN__=${token};`,
		);
		return new Response(page, { headers: SECURITY_HEADERS });
	},
};
