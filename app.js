/* CGT Tours — web app */
const S = { token: localStorage.getItem('cgt_token') || '', me: null, quote: null, svc: 'flights', di: 0, res: {}, filt: { stars: [5, 4, 3, 2], refund: false, bf: false, name: '' } };
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = 'PKR') => `${cur} ${cur === 'PKR' ? Math.round(+n || 0).toLocaleString('en-PK') : (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pkr = n => money(n, 'PKR');
const fd = s => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fdw = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const dmy2iso = s => s ? s.split('-').reverse().join('-') : '';
const hm = t => t ? `${String(t).slice(0, 2)}:${String(t).slice(2, 4)}` : '';
const dur = d => d ? `${+String(d).padStart(4, '0').slice(0, 2)}h ${String(d).padStart(4, '0').slice(2)}m` : '';
const AL = { FZ: 'flydubai', EK: 'Emirates', PK: 'PIA', QR: 'Qatar Airways', EY: 'Etihad', PA: 'Airblue', ER: 'SereneAir', PF: 'AirSial', G9: 'Air Arabia', SV: 'Saudia', XY: 'flynas', TK: 'Turkish Airlines', PC: 'Pegasus', J2: 'AZAL', MH: 'Malaysia Airlines', TG: 'Thai Airways', UL: 'SriLankan', OD: 'Batik Air', AK: 'AirAsia', D7: 'AirAsia X', WY: 'Oman Air', GF: 'Gulf Air', KU: 'Kuwait Airways', J9: 'Jazeera', SQ: 'Singapore Airlines', CZ: 'China Southern', HY: 'Uzbekistan Airways', KC: 'Air Astana', BA: 'British Airways' };
const alColor = c => { let h = 0; for (const ch of String(c || 'XX')) h = (h * 31 + ch.charCodeAt(0)) % 360; return `linear-gradient(135deg,hsl(${h} 60% 42%),hsl(${(h + 40) % 360} 65% 32%))`; };
const TYPES = { T: ['Ticket only', '✈️', 'Air tickets'], TH: ['Ticket + Hotel', '✈️🏨', 'Air tickets with hotels'], FULL: ['Complete package', '✈️🏨🚐🎡', 'Tickets, hotels, transfers & sightseeing'], LAND: ['Land package', '🏨🚐🎡', 'Hotels, transfers & sightseeing (no tickets)'] };
const SVCS = { T: ['flights', 'extras'], TH: ['flights', 'hotels', 'extras'], FULL: ['flights', 'transfers', 'activities', 'hotels', 'extras'], LAND: ['transfers', 'activities', 'hotels', 'extras'] };
const SVC_LABEL = { flights: '✈️ Flights', hotels: '🏨 Hotels', transfers: '🚐 Transfers', activities: '🎡 Tours & Sightseeing', extras: '➕ Visa & Extras' };
const KIND_LABEL = { flight: 'Air tickets', hotel: 'Hotels', transfer: 'Transfers', activity: 'Tours & sightseeing', extra: 'Visa & extras' };
const NATS = [['PK', 'Pakistan'], ['AE', 'UAE'], ['SA', 'Saudi Arabia'], ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AF', 'Afghanistan'], ['IN', 'India'], ['BD', 'Bangladesh']];

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, err ? 6000 : 3000); }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ error: 'Server error (' + r.status + ')' }));
  if (r.status === 401 && path !== '/api/login') { logout(); throw new Error(j.error || 'Please sign in'); }
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
  return j;
}
const busy = (btn, on, text) => { if (!btn) return; if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = text || 'Please wait…'; } else { btn.disabled = false; btn.innerHTML = btn.dataset.t || btn.innerHTML; } };
function modal(html, narrow) { $('#modalBody').innerHTML = html; $('.modal-card').classList.toggle('narrow', !!narrow); $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
document.addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function logout() { localStorage.removeItem('cgt_token'); S.token = ''; S.me = null; S.quote = null; history.replaceState(null, '', location.pathname); render(); }
const can = p => S.me && S.me.perms[p];
const stCls = s => String(s || '').split(' ')[0];

/* ================= shell ================= */
function shell(active, inner) {
  const u = S.me.user;
  const tabs = [['dashboard', 'Dashboard'], ['new', 'New Package'], ['quotes', 'Quotations']].concat(can('process') ? [['bookings', 'Bookings']] : []).concat(can('admin') ? [['admin/users', 'Team & Agents'], ['admin/settings', 'Margins & Settings'], ['admin/destinations', 'Destinations']] : []);
  $('#app').innerHTML = `
  <header class="top"><div class="wrap top-in"><div class="logo"><i></i>CGT Tours<span>Package Costing</span></div><div class="sp"></div>
    <div class="who">${esc(u.name)} · ${esc(u.role)}${u.agency && u.agency.name ? ' · ' + esc(u.agency.name) : ''}</div>
    <button class="tbtn" id="pwBtn">Password</button><button class="tbtn" id="outBtn">Logout</button></div></header>
  <nav class="tabs"><div class="wrap tabs-in">${tabs.map(([k, l]) => `<a class="tab${active === k ? ' on' : ''}" href="#${k}">${l}${k === 'bookings' && S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''}</a>`).join('')}</div></nav>
  <main><div class="wrap" id="page">${inner || ''}</div></main>`;
  $('#outBtn').onclick = logout;
  $('#pwBtn').onclick = changePassword;
}
function changePassword() {
  modal(`<div class="modal-h">Change password</div><form class="modal-b" id="pwF"><div class="row"><label class="f">Current password<input type="password" name="o" required></label></div><div class="row" style="margin-top:.7rem"><label class="f">New password (min 8)<input type="password" name="n" minlength="8" required></label></div><div class="modal-f" style="padding:1rem 0 0"><button class="btn red">Save</button></div></form>`, true);
  $('#pwF').onsubmit = async e => { e.preventDefault(); try { const r = await api('POST', '/api/me/password', { oldPassword: e.target.o.value, newPassword: e.target.n.value }); S.token = r.token; localStorage.setItem('cgt_token', r.token); closeModal(); toast('Password changed'); } catch (err) { toast(err.message, 1); } };
}

/* ================= login ================= */
function loginPage() {
  $('#app').innerHTML = `<div class="login"><form class="box" id="lf"><div class="logo"><i></i>CGT Tours</div><p class="muted" style="margin:0 0 1.4rem">Package costing system · Choudhary Group of Travels</p>
    <label class="f">Username<input name="u" autocomplete="username" required autofocus></label><label class="f" style="margin-top:.8rem">Password<input type="password" name="p" autocomplete="current-password" required></label>
    <button class="btn red lg" style="width:100%;margin-top:1.2rem">Sign in</button><p id="le" class="small" style="color:#b42318;min-height:1.2em"></p></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('button'); busy(b, 1, 'Signing in…');
    try { const r = await api('POST', '/api/login', { username: e.target.u.value, password: e.target.p.value }); S.token = r.token; localStorage.setItem('cgt_token', r.token); await boot(); }
    catch (err) { $('#le').textContent = err.message; busy(b, 0); }
  };
}

/* ================= router ================= */
async function render() {
  if (!S.token) return loginPage();
  if (!S.me) { try { S.me = await api('GET', '/api/me'); } catch { return loginPage(); } }
  const [r, a, b] = (location.hash.replace(/^#/, '') || 'dashboard').split('/');
  closeModal();
  try {
    if (r === 'dashboard') return dashboard();
    if (r === 'new') return setupPage();
    if (r === 'quotes') return quotesPage();
    if (r === 'q' && b === 'build') return builderPage(a);
    if (r === 'q' && b === 'edit') return setupPage(a);
    if (r === 'q') return quotePage(a);
    if (r === 'bookings' && can('process')) return bookingsPage();
    if (r === 'booking' && can('process')) return processPage(a);
    if (r === 'admin' && can('admin')) return a === 'settings' ? settingsPage() : a === 'destinations' ? destPage() : usersPage();
    location.hash = 'dashboard';
  } catch (e) { shell('', `<div class="empty">${esc(e.message)}</div>`); }
}
window.addEventListener('hashchange', render);
async function boot() { S.me = null; await render(); refreshPending(); }
async function refreshPending() { if (!can('process')) return; try { const r = await api('GET', '/api/bookings'); S.pendingCount = r.bookings.filter(b => b.status === 'Booking Requested').length; const t = $('a.tab[href="#bookings"]'); if (t) t.innerHTML = 'Bookings' + (S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''); } catch {} }

/* ================= dashboard ================= */
async function dashboard() {
  shell('dashboard', '<div class="loading"><div class="spin"></div></div>');
  const d = await api('GET', '/api/dashboard');
  const days = new Date(+d.month.slice(0, 4), +d.month.slice(5), 0).getDate(), mx = Math.max(1, ...Object.values(d.byDay));
  const bars = (obj) => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8), m = Math.max(1, ...e.map(x => x[1])); return e.length ? `<div class="bars">${e.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="t"><i style="width:${v / m * 100}%"></i></div><b>${v}</b></div>`).join('')}</div>` : '<p class="muted small">No data yet this month.</p>'; };
  $('#page').innerHTML = `
    <div class="page-h"><h1>Dashboard</h1><a class="btn red" href="#new">+ New package</a></div>
    <div class="kpis">
      <div class="kpi dark"><div class="l">Quotations · ${new Date(d.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div><div class="v">${d.quotations}</div><div class="s">today: ${d.today} · ${d.pax} travellers</div></div>
      <div class="kpi"><div class="l">Booking requests</div><div class="v">${d.pending}</div><div class="s">waiting for processing</div></div>
      <div class="kpi"><div class="l">Processing</div><div class="v">${d.processing}</div><div class="s">being booked</div></div>
      <div class="kpi"><div class="l">Confirmed this month</div><div class="v">${d.confirmed}</div><div class="s">${pkr(d.confirmedValuePKR)}</div></div>
      ${d.profitPKR !== undefined ? `<div class="kpi"><div class="l">Profit (confirmed)</div><div class="v">${pkr(d.profitPKR)}</div><div class="s">after supplier cost</div></div>` : ''}
    </div>
    <div class="grid3">
      <div class="card"><h3>Quotations per day</h3><div class="spark">${[...Array(days)].map((_, i) => { const v = d.byDay[String(i + 1).padStart(2, '0')] || 0; return `<i style="height:${v / mx * 100}%" data-v="${i + 1}: ${v}"></i>`; }).join('')}</div><div class="small muted" style="display:flex;justify-content:space-between"><span>1</span><span>${days}</span></div></div>
      <div class="card"><h3>Destinations</h3>${bars(d.byDest)}</div>
      <div class="card"><h3>${Object.keys(d.byAgent).length ? 'By team member / agent' : 'Quick start'}</h3>${Object.keys(d.byAgent).length ? bars(d.byAgent) : `<p class="small muted">1. Click <b>New package</b> · 2. pick flights, transfers, tours & hotels · 3. save and share by WhatsApp or PDF.</p>`}</div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Recent quotations</h3>${recentTable(d.recent)}</div>`;
}
const recentTable = list => list.length ? `<div class="tbl-wrap" style="box-shadow:none"><table><thead><tr><th>Ref</th><th>Name</th><th>Cities</th><th>Start</th><th>By</th><th class="right">Price</th><th>Status</th></tr></thead><tbody>${list.map(q => `<tr style="cursor:pointer" onclick="location.hash='q/${q.id}'"><td class="nowrap"><b>${esc(q.ref)}</b></td><td>${esc(q.name)}</td><td>${esc(q.cities)}</td><td class="nowrap">${fd(q.start)}</td><td>${esc(q.owner)}</td><td class="right nowrap"><b>${money(q.total, q.currency)}</b></td><td><span class="st ${stCls(q.status)}">${esc(q.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No quotations yet.</p>';

/* ================= step 1: setup ================= */
async function setupPage(editId) {
  shell(editId ? 'quotes' : 'new', '<div class="loading"><div class="spin"></div></div>');
  let q = null;
  if (editId) q = (await api('GET', '/api/quotes/' + editId)).quote;
  const D = S.me.destinations, countries = [...new Set(D.map(d => d.country))];
  const t = q ? q.trip : null;
  const st = { type: q ? q.type : 'FULL', dests: t ? t.destinations.map(d => ({ country: d.country, destId: d.destId, nights: d.nights })) : [{ country: '', destId: '', nights: 3 }], rooms: t ? t.rooms.map(r => ({ ...r, childAges: [...r.childAges] })) : [{ adults: 2, childAges: [] }] };
  const tomorrow = new Date(Date.now() + 864e5 * 7).toISOString().slice(0, 10);
  $('#page').innerHTML = `<div class="setup">
    <div class="hero"><h1>${editId ? 'Modify package' : 'Build a custom package'}</h1><p>Choose the package type, dates, cities and travellers — we price the whole trip together.</p></div>
    <form class="setup-card" id="sf">
      <div class="sec">Package type</div>
      <div class="types">${Object.entries(TYPES).map(([k, [l, ic, s]]) => `<button type="button" class="type${st.type === k ? ' on' : ''}" data-t="${k}"><span class="ic">${ic}</span><b>${l}</b><small>${s}</small></button>`).join('')}</div>
      <div class="sec">Travel dates & travellers <span class="nights-tag" id="nt"></span></div>
      <div class="row">
        <label class="f" style="flex:2">Quotation name<input name="name" placeholder="e.g. Mr Ali – Malaysia family trip" value="${esc(q ? q.name : '')}"></label>
        <label class="f">Flying from (airport)<input name="origin" maxlength="3" value="${esc(t ? t.origin : 'LHE')}" style="text-transform:uppercase" list="aps" required></label>
        <label class="f">Start date (check-in)<input type="date" name="start" value="${t ? t.start : tomorrow}" required></label>
        <label class="f">Nationality<select name="nationality">${NATS.map(([c, n]) => `<option value="${c}" ${(t ? t.nationality : 'PK') === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f">Residence<select name="residence">${NATS.map(([c, n]) => `<option value="${c}" ${(t ? t.residence : 'PK') === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <datalist id="aps">${(window.AIRPORTS || []).map(a => `<option value="${a[0]}">${esc(a[1])} – ${esc(a[2])}</option>`).join('')}</datalist>
      <div class="sec">Destinations (in travel order)</div>
      <div id="dests"></div>
      <button type="button" class="btn ghost sm" id="addD">+ Add destination</button>
      <div class="sec">Rooms & occupancy</div>
      <div id="rooms"></div>
      <button type="button" class="btn ghost sm" id="addR">+ Add room</button>
      <div style="display:flex;justify-content:center;margin-top:1.4rem"><button class="btn red lg" id="go">🔍 ${editId ? 'Update & continue' : 'Start costing'}</button></div>
    </form></div>`;
  const drawD = () => {
    $('#dests').innerHTML = st.dests.map((d, i) => `<div class="dest-row"><label class="f">Country<select data-c="${i}"><option value="">Select country</option>${countries.map(c => `<option ${d.country === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="f">City<select data-d="${i}" required><option value="">Select city</option>${D.filter(x => x.country === d.country).map(x => `<option value="${x.id}" ${d.destId === x.id ? 'selected' : ''}>${esc(x.city)}</option>`).join('')}</select></label>
      <label class="f">Nights<input type="number" min="1" max="30" value="${d.nights}" data-n="${i}"></label>
      <button type="button" class="iconx" data-xd="${i}" ${st.dests.length < 2 ? 'disabled' : ''}>×</button></div>`).join('');
    const nights = st.dests.reduce((s, d) => s + (+d.nights || 0), 0); $('#nt').textContent = `${nights} night${nights > 1 ? 's' : ''} total`;
  };
  const drawR = () => {
    $('#rooms').innerHTML = st.rooms.map((r, i) => `<div class="room-row"><div><div class="tiny muted" style="font-weight:800">ROOM ${i + 1}</div><div style="font-weight:900;font-size:1.1rem">🛏 ${i + 1}</div></div>
      <label class="f">Adults<select data-ra="${i}">${[1, 2, 3, 4, 5, 6].map(n => `<option ${r.adults === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f">Children<select data-rc="${i}">${[0, 1, 2, 3, 4].map(n => `<option ${r.childAges.length === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div><div class="tiny muted" style="font-weight:800;margin-bottom:.3rem">${r.childAges.length ? 'CHILD AGES (0–17)' : '&nbsp;'}</div><div class="ages">${r.childAges.map((a, k) => `<select data-age="${i}|${k}">${[...Array(18)].map((_, n) => `<option ${a === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`).join('')}</div></div>
      <button type="button" class="iconx" data-xr="${i}" ${st.rooms.length < 2 ? 'disabled' : ''}>×</button></div>`).join('');
  };
  drawD(); drawR();
  $$('.type').forEach(b => b.onclick = () => { st.type = b.dataset.t; $$('.type').forEach(x => x.classList.toggle('on', x === b)); });
  $('#sf').addEventListener('change', e => {
    const x = e.target;
    if (x.dataset.c != null) { st.dests[x.dataset.c].country = x.value; st.dests[x.dataset.c].destId = ''; drawD(); }
    if (x.dataset.d != null) st.dests[x.dataset.d].destId = x.value;
    if (x.dataset.n != null) { st.dests[x.dataset.n].nights = Math.max(1, +x.value || 1); drawD(); }
    if (x.dataset.ra != null) st.rooms[x.dataset.ra].adults = +x.value;
    if (x.dataset.rc != null) { const r = st.rooms[x.dataset.rc], n = +x.value; r.childAges = r.childAges.slice(0, n); while (r.childAges.length < n) r.childAges.push(6); drawR(); }
    if (x.dataset.age) { const [i, k] = x.dataset.age.split('|'); st.rooms[i].childAges[k] = +x.value; }
  });
  $('#sf').addEventListener('click', e => {
    if (e.target.dataset.xd != null) { st.dests.splice(+e.target.dataset.xd, 1); drawD(); }
    if (e.target.dataset.xr != null) { st.rooms.splice(+e.target.dataset.xr, 1); drawR(); }
  });
  $('#addD').onclick = () => { st.dests.push({ country: st.dests[st.dests.length - 1].country, destId: '', nights: 2 }); drawD(); };
  $('#addR').onclick = () => { if (st.rooms.length >= 6) return toast('Maximum 6 rooms'); st.rooms.push({ adults: 2, childAges: [] }); drawR(); };
  $('#sf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $('#go');
    if (st.dests.some(d => !d.destId)) return toast('Choose a city for every destination', 1);
    const body = { name: f.name.value, type: st.type, trip: { origin: f.origin.value.toUpperCase(), start: f.start.value, nationality: f.nationality.value, residence: f.residence.value, destinations: st.dests, rooms: st.rooms } };
    busy(btn, 1, 'Starting…');
    try {
      let r;
      if (editId) {
        try { r = await api('PUT', '/api/quotes/' + editId, body); }
        catch (err) { if (err.status === 409 && confirm(err.message)) r = await api('PUT', '/api/quotes/' + editId, { ...body, clearItems: true }); else throw err; }
      } else r = await api('POST', '/api/quotes', body);
      S.quote = r.quote; S.res = {}; S.svc = SVCS[r.quote.type][0]; S.di = 0;
      location.hash = `q/${r.quote.id}/build`;
    } catch (err) { toast(err.message, 1); busy(btn, 0); }
  };
}

/* ================= step 2: builder ================= */
const cartCount = q => Object.values(q.items).flat().length;
async function builderPage(id) {
  if (!S.quote || S.quote.id !== id) { shell('new', '<div class="loading"><div class="spin"></div></div>'); const r = await api('GET', '/api/quotes/' + id); S.quote = r.quote; S.res = {}; if (!r.canEdit) { location.hash = 'q/' + id; return; } S.svc = SVCS[r.quote.type][0]; }
  shell('new', '');
  const q = S.quote, t = q.trip;
  const pax = `${t.pax.adt} Adult${t.pax.adt > 1 ? 's' : ''}${t.pax.chd ? `, ${t.pax.chd} Child` : ''}${t.pax.inf ? `, ${t.pax.inf} Infant` : ''}`;
  $('#page').innerHTML = `
    <div class="sumbar"><div class="it"><div class="l">${esc(q.ref)} · ${TYPES[q.type][0]}</div><div class="v">${esc(q.name)}</div></div>
      <div class="it"><div class="l">Travel dates</div><div class="v">${fd(t.start)} – ${fd(t.end)}</div></div>
      <div class="it"><div class="l">Travellers</div><div class="v">${pax} · ${t.rooms.length} room${t.rooms.length > 1 ? 's' : ''}</div></div>
      <div class="it"><div class="l">Cities</div><div class="v">${t.destinations.map(d => `${esc(d.city)} (${d.nights}N)`).join(' → ')}</div></div>
      <div class="sp"></div><a class="btn ghost sm" href="#q/${q.id}/edit" style="margin-right:.6rem">Modify search</a>
      <button class="btn red cartbtn" id="cartBtn">🛒 Cart · <span id="cartTot">${money(q.pricing.total, q.pricing.currency)}</span><span class="badge" id="cartN">${cartCount(q)}</span></button></div>
    <div class="builder"><aside class="card side" id="side"></aside><div><div class="svc-tabs" id="svcTabs"></div><div id="svcBody"></div></div></div>`;
  $('#cartBtn').onclick = openCart;
  drawTabs(); drawSide(); drawSvc();
}
function refreshCart() {
  const q = S.quote; if (!$('#cartN')) return;
  $('#cartN').textContent = cartCount(q); $('#cartTot').textContent = money(q.pricing.total, q.pricing.currency);
  drawTabs(); drawSide();
}
function drawTabs() {
  const q = S.quote, has = { flights: q.items.flights.length, hotels: q.items.hotels.length, transfers: q.items.transfers.length, activities: q.items.activities.length, extras: q.items.extras.length };
  $('#svcTabs').innerHTML = SVCS[q.type].map(s => `<button class="svc${S.svc === s ? ' on' : ''}" data-s="${s}">${SVC_LABEL[s]}${has[s] ? '<span class="dot"></span>' : ''}</button>`).join('');
  $$('#svcTabs .svc').forEach(b => b.onclick = () => { S.svc = b.dataset.s; drawTabs(); drawSide(); drawSvc(); });
}
function drawSide() {
  const q = S.quote, multi = ['hotels', 'transfers', 'activities'].includes(S.svc);
  const prov = S.me.providers[{ flights: 'flights', hotels: 'hotels', transfers: 'transfers', activities: 'activities' }[S.svc]];
  $('#side').innerHTML = `
    ${multi ? `<h4>Destinations</h4>${q.trip.destinations.map((d, i) => `<label class="chk"><input type="radio" name="di" value="${i}" ${S.di === i ? 'checked' : ''}> ${esc(d.city)}, ${esc(d.country)} <span class="muted small">${d.nights}N</span></label>`).join('')}` : ''}
    ${S.svc === 'hotels' ? `<h4>Star rating</h4>${[5, 4, 3, 2].map(s => `<label class="chk"><input type="checkbox" class="fs" value="${s}" ${S.filt.stars.includes(s) ? 'checked' : ''}> ${'★'.repeat(s)}${s === 2 ? ' & below' : ''}</label>`).join('')}
      <h4>Popular filters</h4><label class="chk"><input type="checkbox" id="fRef" ${S.filt.refund ? 'checked' : ''}> Free cancellation</label><label class="chk"><input type="checkbox" id="fBf" ${S.filt.bf ? 'checked' : ''}> Breakfast included</label>
      <h4>Hotel name</h4><input id="fName" placeholder="Search hotel" value="${esc(S.filt.name)}">` : ''}
    <h4>In this package</h4>
    ${['flight', 'hotel', 'transfer', 'activity', 'extra'].map(k => { const n = Object.values(q.items).flat().filter(i => i.kind === k).length; return n ? `<div class="small" style="display:flex;justify-content:space-between;padding:.15rem 0"><span>${KIND_LABEL[k]} (${n})</span><b>${money(q.pricing.lines[k], q.pricing.currency)}</b></div>` : ''; }).join('') || '<p class="small muted">Nothing added yet.</p>'}
    <div style="border-top:1px solid var(--line);margin-top:.5rem;padding-top:.5rem;display:flex;justify-content:space-between"><b>Total</b><b>${money(q.pricing.total, q.pricing.currency)}</b></div>
    <div class="small muted">Per person: ${money(q.pricing.perPerson, q.pricing.currency)}</div>
    <button class="btn red" style="width:100%;margin-top:.8rem" id="sideSave">Review & save quotation</button>
    ${prov ? `<p class="tiny muted" style="margin-top:.8rem">${prov.live ? '🟢 Live: ' + esc(prov.name) : '🟡 Demo data — add the supplier key on the server'}</p>` : ''}`;
  $$('#side [name=di]').forEach(r => r.onchange = () => { S.di = +r.value; drawSvc(); });
  $$('#side .fs').forEach(c => c.onchange = () => { S.filt.stars = $$('#side .fs:checked').map(x => +x.value); drawHotelList(); });
  if ($('#fRef')) { $('#fRef').onchange = e => { S.filt.refund = e.target.checked; drawHotelList(); }; $('#fBf').onchange = e => { S.filt.bf = e.target.checked; drawHotelList(); }; $('#fName').oninput = e => { S.filt.name = e.target.value; drawHotelList(); }; }
  $('#sideSave').onclick = openCart;
}
const loading = msg => `<div class="loading"><div class="spin"></div><b>${esc(msg)}</b><p class="small muted">Checking live availability…</p></div>`;
const resKey = () => `${S.svc}|${S.di}`;
async function addItem(body, btn) {
  busy(btn, 1, 'Adding…');
  try { const r = await api('POST', `/api/quotes/${S.quote.id}/items`, body); S.quote = r.quote; refreshCart(); toast('Added to cart ✓'); return true; }
  catch (e) { toast(e.message, 1); return false; } finally { busy(btn, 0); }
}
async function removeItem(id) { const r = await api('DELETE', `/api/quotes/${S.quote.id}/items/${id}`); S.quote = r.quote; refreshCart(); }

function drawSvc() {
  const fn = { flights: flightsTab, hotels: hotelsTab, transfers: transfersTab, activities: activitiesTab, extras: extrasTab }[S.svc];
  fn();
}

/* ---- flights ---- */
function defaultLegs(t) {
  const legs = [], ds = t.destinations; let prev = t.origin;
  ds.forEach((d, i) => { if (d.iata !== prev) legs.push({ from: prev, to: d.iata, date: d.checkIn }); prev = d.iata; });
  if (prev !== t.origin) legs.push({ from: prev, to: t.origin, date: t.end });
  return legs.length ? legs : [{ from: t.origin, to: ds[0].iata, date: t.start }];
}
function flightsTab() {
  const q = S.quote, sel = q.items.flights[0];
  S.legs = S.legs && S.legs.qid === q.id ? S.legs : Object.assign(defaultLegs(q.trip), { qid: q.id });
  $('#svcBody').innerHTML = `
    ${sel ? `<div class="notice ok"><b>Selected:</b> ${esc(sel.title)} ${sel.airline ? '· ' + esc(AL[sel.airline] || sel.airline) : ''} — ${money(sel.sellPKR, 'PKR')} <button class="btn link" id="rmF">Remove</button></div>` : ''}
    <div class="card" style="margin-bottom:12px"><h3>Flight search</h3>
      <div id="legs">${S.legs.map((l, i) => `<div class="row" style="margin-bottom:.5rem"><label class="f">From<input data-lf="${i}" value="${l.from}" maxlength="3" list="aps2" style="text-transform:uppercase"></label><label class="f">To<input data-lt="${i}" value="${l.to}" maxlength="3" list="aps2" style="text-transform:uppercase"></label><label class="f">Date<input type="date" data-ld="${i}" value="${l.date}"></label><button class="iconx" data-lx="${i}" style="flex:0 0 40px" ${S.legs.length < 2 ? 'disabled' : ''}>×</button></div>`).join('')}</div>
      <datalist id="aps2">${(window.AIRPORTS || []).map(a => `<option value="${a[0]}">${esc(a[1])}</option>`).join('')}</datalist>
      <div class="row"><button class="btn ghost sm" id="addLeg" style="flex:0">+ Add flight</button><label class="f" style="flex:0 0 160px">Cabin<select id="cab"><option value="Y">Economy</option><option value="W">Premium economy</option><option value="C">Business</option><option value="F">First</option></select></label><label class="chk" style="flex:0 0 auto"><input type="checkbox" id="nonstop"> Direct only</label><button class="btn red" id="fGo" style="flex:0 0 auto">Search flights</button><button class="btn ghost" id="fMan" style="flex:0 0 auto">Enter ticket price manually</button></div>
      <p class="tiny muted" style="margin:.6rem 0 0">${q.trip.pax.adt} adult(s), ${q.trip.pax.chd} child, ${q.trip.pax.inf} infant · routes are filled from your destinations — change them if needed.</p></div>
    <div id="fList"></div>`;
  if (sel) $('#rmF').onclick = () => removeItem(sel.id).then(flightsTab);
  $('#legs').addEventListener('change', e => { const x = e.target, v = x.value.toUpperCase(); if (x.dataset.lf) S.legs[x.dataset.lf].from = v; if (x.dataset.lt) S.legs[x.dataset.lt].to = v; if (x.dataset.ld) S.legs[x.dataset.ld].date = x.value; });
  $('#legs').addEventListener('click', e => { if (e.target.dataset.lx != null) { S.legs.splice(+e.target.dataset.lx, 1); flightsTab(); } });
  $('#addLeg').onclick = () => { const l = S.legs[S.legs.length - 1]; S.legs.push({ from: l.to, to: '', date: l.date }); flightsTab(); };
  $('#fMan').onclick = manualFlight;
  $('#fGo').onclick = async () => {
    const btn = $('#fGo'); busy(btn, 1, 'Searching…'); $('#fList').innerHTML = loading('Searching airlines');
    try { S.res.flights = await api('POST', `/api/quotes/${q.id}/search/flights`, { legs: S.legs, cabin: $('#cab').value, nonStop: $('#nonstop').checked }); drawFlights(); }
    catch (e) { $('#fList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; } finally { busy(btn, 0); }
  };
  if (S.res.flights) drawFlights();
}
function legHtml(l) {
  const a = l.segments[0], b = l.segments[l.segments.length - 1], st = l.segments.length - 1;
  return `<div class="leg"><div class="al"><div class="b" style="background:${alColor(l.airline)}">${esc(l.airline)}</div><div><b class="small">${esc(AL[l.airline] || l.airline)}</b><div class="tiny muted">${l.segments.map(s => esc(s.mktg + ' ' + s.flightNo)).join(' · ')}</div></div></div>
    <div class="tm"><div><b>${hm(a.depTime)}</b><div class="tiny muted">${esc(a.from)} · ${fd(dmy2iso(a.depDate))}</div></div><div class="ln">${dur(l.duration)}<br>${st ? `<span style="color:var(--red)">${st} stop · ${l.segments.slice(0, -1).map(s => s.to).join(', ')}</span>` : '<span style="color:var(--ok)">Direct</span>'}</div><div class="right"><b>${hm(b.arrTime)}</b><div class="tiny muted">${esc(b.to)}</div></div></div></div>`;
}
function drawFlights() {
  const r = S.res.flights, q = S.quote;
  if (!r.flights.length) { $('#fList').innerHTML = `<div class="empty">No flights found. ${(r.warnings || []).map(esc).join(' ')}<br>Try other dates or enter the ticket price manually.</div>`; return; }
  $('#fList').innerHTML = `<div class="list">${r.flights.slice(0, 40).map(f => `<div class="flt"><div class="legs">${f.legs.map(legHtml).join('')}</div>
    <div class="res pr" style="box-shadow:none;border-radius:0"><div><span class="pill ${f.refundable ? 'ok' : ''}">${f.refundable ? 'Refundable' : 'Non-refundable'}</span> ${f.baggage ? `<span class="pill">🧳 ${esc(f.baggage)}</span>` : ''}</div><div class="p">${pkr(f.sell)}</div><div class="tiny muted">total for all travellers${f.net ? ` · net ${money(f.net, f.netCurrency)}` : ''}</div><button class="btn red sm" data-f="${f.idx}">Select</button></div></div>`).join('')}</div>`;
  $$('#fList [data-f]').forEach(b => b.onclick = async () => { if (await addItem({ service: 'flights', searchId: r.searchId, idx: +b.dataset.f }, b)) flightsTab(); });
}
function manualFlight() {
  const p = S.quote.trip.pax;
  modal(`<div class="modal-h">Ticket price (manual)</div><form class="modal-b" id="mf">
    <div class="row"><label class="f" style="flex:2">Airline / route / details<input name="title" value="Air ticket ${esc(S.legs.map(l => l.from + '-' + l.to).join(' / '))}" required></label><label class="f">Currency<select name="cur">${S.me.currencies.map(c => `<option>${c}</option>`).join('')}</select></label></div>
    <div class="row" style="margin-top:.7rem"><label class="f">Adult fare<input type="number" name="adt" min="0" step="any" required></label>${p.chd ? '<label class="f">Child fare<input type="number" name="chd" min="0" step="any"></label>' : ''}${p.inf ? '<label class="f">Infant fare<input type="number" name="inf" min="0" step="any"></label>' : ''}</div>
    <label class="chk" style="margin-top:.8rem"><input type="checkbox" name="final"> This is the final selling fare (do not add margin)</label>
    <div class="modal-f" style="padding:1rem 0 0"><button class="btn red">Add to cart</button></div></form>`, true);
  $('#mf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('POST', `/api/quotes/${S.quote.id}/manual`, { kind: 'flight', title: f.title.value, currency: f.cur.value, perPax: { adt: f.adt.value, chd: f.chd ? f.chd.value : 0, inf: f.inf ? f.inf.value : 0 }, sellIsFinal: f.final.checked }); S.quote = r.quote; closeModal(); refreshCart(); flightsTab(); toast('Ticket added ✓'); }
    catch (err) { toast(err.message, 1); }
  };
}

/* ---- hotels ---- */
async function hotelsTab() {
  const q = S.quote, d = q.trip.destinations[S.di], sel = q.items.hotels.find(h => h.destIdx === S.di);
  $('#svcBody').innerHTML = `${sel ? `<div class="notice ok"><b>Selected in ${esc(d.city)}:</b> ${esc(sel.title)} · ${esc(sel.rooms ? sel.rooms.map(r => r.roomName).join(', ') : sel.details || '')} · ${esc(sel.board || '')} — ${pkr(sel.sellPKR)} <button class="btn link" id="rmH">Remove</button></div>` : ''}
    <div class="row" style="margin-bottom:12px;align-items:center"><div><b>${esc(d.city)}</b> · ${fdw(d.checkIn)} – ${fdw(d.checkOut)} · ${d.nights} night(s)</div><div style="flex:0 0 auto" class="actions"><select id="hSort" style="width:auto"><option value="p">Lowest price</option><option value="s">Star rating</option></select><button class="btn ghost sm" id="hMan">Add hotel manually</button></div></div>
    <div id="hList"></div>`;
  if (sel) $('#rmH').onclick = () => removeItem(sel.id).then(hotelsTab);
  $('#hMan').onclick = () => manualItem('hotel', `Hotel in ${d.city} (${d.nights} nights)`);
  $('#hSort').onchange = drawHotelList;
  const k = resKey();
  if (!S.res[k]) {
    $('#hList').innerHTML = loading(`Finding hotels in ${d.city}`);
    try { S.res[k] = await api('POST', `/api/quotes/${q.id}/search/hotels`, { destIdx: S.di }); } catch (e) { $('#hList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  drawHotelList();
}
const BF = /breakfast|half board|full board|all inclusive|BB|HB|FB|AI/i;
function drawHotelList() {
  const r = S.res[resKey()]; if (!r || !$('#hList')) return;
  const f = S.filt;
  let list = r.hotels.filter(h => f.stars.includes(Math.max(2, Math.min(5, h.stars || 2))) && (!f.name || h.name.toLowerCase().includes(f.name.toLowerCase())) && (!f.refund || h.groups.every(g => g.options.some(o => o.refundable))) && (!f.bf || h.groups.every(g => g.options.some(o => BF.test(o.board)))));
  if ($('#hSort') && $('#hSort').value === 's') list = list.slice().sort((a, b) => b.stars - a.stars);
  if (!list.length) { $('#hList').innerHTML = `<div class="empty">No hotels match. ${r.hotels.length ? 'Change the filters.' : 'No availability — try other dates or add the hotel manually.'}</div>`; return; }
  $('#hList').innerHTML = `<div class="list">${list.slice(0, 40).map(h => `<div class="res" data-hc="${h.idx}">
    <div class="img" style="${h.images[0] ? `background-image:url('${esc(h.images[0])}')` : `background:${alColor(h.name)}`}">${h.images[0] ? '' : esc(h.name[0])}</div>
    <div class="bd"><div class="stars">${'★'.repeat(h.stars || 0)}</div><h3>${esc(h.name)}</h3><div class="small muted">${esc([h.zone, h.city].filter(Boolean).join(', '))}</div>
      ${h.groups.map((g, gi) => `<div class="glabel">${esc(g.label)}</div>${g.options.slice(0, 4).map((o, oi) => `<label class="opt${oi === 0 ? ' on' : ''}"><input type="radio" name="h${h.idx}g${gi}" value="${o.id}" ${oi === 0 ? 'checked' : ''}><div><b>${esc(o.roomName)}</b><div class="tiny ${o.refundable ? '' : 'muted'}" style="${o.refundable ? 'color:var(--ok)' : ''}">${esc(o.board)} · ${esc(o.cancel)}</div></div><div class="p">${pkr(o.sell)}${o.net ? `<div class="tiny muted">net ${money(o.net, o.netCurrency)}</div>` : ''}</div></label>`).join('')}${g.options.length > 4 ? `<details><summary class="small" style="cursor:pointer;color:var(--blue);margin-top:.3rem">${g.options.length - 4} more room options</summary>${g.options.slice(4).map(o => `<label class="opt"><input type="radio" name="h${h.idx}g${gi}" value="${o.id}"><div><b>${esc(o.roomName)}</b><div class="tiny muted">${esc(o.board)} · ${esc(o.cancel)}</div></div><div class="p">${pkr(o.sell)}</div></label>`).join('')}</details>` : ''}`).join('')}
    </div>
    <div class="pr"><div class="tiny muted">${h.nights} night(s), total</div><div class="p" data-tot="${h.idx}">${pkr(h.from)}</div><button class="btn red sm" data-addh="${h.idx}">Add to cart</button>${h.description ? `<button class="btn link small" data-info="${h.idx}">Hotel info</button>` : ''}</div></div>`).join('')}</div>`;
  $$('#hList .opt input').forEach(i => i.onchange = () => {
    const card = i.closest('.res'), h = r.hotels[+card.dataset.hc];
    $$(`input[name="${i.name}"]`, card).forEach(x => x.closest('.opt').classList.toggle('on', x.checked));
    const tot = h.groups.reduce((s, g, gi) => { const v = (card.querySelector(`input[name="h${h.idx}g${gi}"]:checked`) || {}).value; return s + ((g.options.find(o => o.id === v) || g.options[0]).sell); }, 0);
    card.querySelector(`[data-tot]`).textContent = pkr(tot);
  });
  $$('#hList [data-addh]').forEach(b => b.onclick = async () => {
    const card = b.closest('.res'), h = r.hotels[+b.dataset.addh];
    const picks = h.groups.map((g, gi) => (card.querySelector(`input[name="h${h.idx}g${gi}"]:checked`) || {}).value);
    if (await addItem({ service: 'hotels', searchId: r.searchId, idx: h.idx, picks }, b)) { delete S.res[`transfers|${S.di}`]; hotelsTab(); }
  });
  $$('#hList [data-info]').forEach(b => b.onclick = () => { const h = r.hotels[+b.dataset.info]; modal(`<div class="modal-h">${esc(h.name)}</div><div class="modal-b">${h.images.length ? `<div style="display:flex;gap:.4rem;overflow:auto;margin-bottom:1rem">${h.images.map(u => `<img src="${esc(u)}" style="height:150px;border-radius:10px">`).join('')}</div>` : ''}<p class="small muted">${esc(h.address)}</p><p>${esc(h.description)}</p></div>`); });
}

/* ---- transfers ---- */
async function transfersTab(force) {
  const q = S.quote, d = q.trip.destinations[S.di], k = resKey();
  const chosen = q.items.transfers.filter(t => t.destIdx === S.di);
  $('#svcBody').innerHTML = `${chosen.map(c => `<div class="notice ok"><b>${c.direction === 'DEPARTURE' ? 'Departure' : c.direction === 'ARRIVAL' ? 'Arrival' : 'Transfer'}:</b> ${esc(c.title)} ${c.vehicle ? '· ' + esc(c.vehicle) : ''} — ${pkr(c.sellPKR)} <button class="btn link" data-rm="${c.id}">Remove</button></div>`).join('')}
    <div class="card" style="margin-bottom:12px"><div class="row" style="align-items:center"><div><b>${esc(d.city)}</b> · airport ⇄ hotel transfers<div class="tiny muted" id="tNote"></div></div>
      <label class="f" style="flex:0 0 150px">Arrival pick-up<input type="time" id="tOut"></label><label class="f" style="flex:0 0 150px">Departure pick-up<input type="time" id="tBack"></label>
      <button class="btn navy" id="tGo" style="flex:0 0 auto">Search</button><button class="btn ghost" id="tMan" style="flex:0 0 auto">Add manually</button></div></div>
    <div id="tList"></div>`;
  $$('#svcBody [data-rm]').forEach(b => b.onclick = () => removeItem(b.dataset.rm).then(() => transfersTab()));
  $('#tMan').onclick = () => manualItem('transfer', `${d.city}: airport transfer`);
  const run = async (extra) => {
    $('#tList').innerHTML = loading(`Finding transfers in ${d.city}`);
    try { S.res[k] = await api('POST', `/api/quotes/${q.id}/search/transfers`, { destIdx: S.di, ...extra }); drawTransfers(); } catch (e) { $('#tList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#tGo').onclick = () => run({ outTime: $('#tOut').value ? $('#tOut').value + ':00' : undefined, backTime: $('#tBack').value ? $('#tBack').value + ':00' : undefined });
  if (!S.res[k] || force) await run({}); else drawTransfers();
}
function drawTransfers() {
  const r = S.res[resKey()]; if (!r) return;
  $('#tOut').value = r.times.out.slice(11, 16); $('#tBack').value = r.times.back.slice(11, 16);
  $('#tNote').textContent = r.hotelChosen ? 'Door-to-door to your selected hotel. Times are taken from the selected flights.' : 'Tip: add the hotel first for exact door-to-door prices (now priced to the city centre).';
  const sec = (dir, label) => { const l = r.transfers.filter(t => t.direction === dir); return l.length ? `<h3 style="margin:.4rem 0 .6rem">${label}</h3><div class="list">${l.map(t => `<div class="res${t.image ? '' : ' noimg'}">${t.image ? `<div class="img" style="background-image:url('${esc(t.image)}');background-size:contain;background-repeat:no-repeat;background-color:#fff"></div>` : ''}
    <div class="bd"><h3>${esc(t.title)} – ${t.type === 'PRIVATE' ? 'Private' : 'Shared'}</h3><div class="small">${esc(t.vehicle)} ${t.category ? '· ' + esc(t.category) : ''} ${t.maxPax ? `· up to ${t.maxPax} passengers` : ''}</div><p class="desc">${esc(t.description)}</p><div class="small muted">🕒 ${fd(t.date)} ${esc(t.time || '')} · ${esc(t.cancel)}</div></div>
    <div class="pr"><div class="tiny muted">Price per transfer</div><div class="p">${pkr(t.sell)}</div>${t.net ? `<div class="tiny muted">net ${money(t.net, t.netCurrency)}</div>` : ''}<button class="btn blue sm" data-t="${t.idx}">Add to cart</button></div></div>`).join('')}</div>` : ''; };
  const html = sec('ARRIVAL', '🛬 Arrival: airport → hotel') + sec('DEPARTURE', '🛫 Departure: hotel → airport');
  $('#tList').innerHTML = html || '<div class="empty">No transfers found for these times. Change the pick-up times or add one manually.</div>';
  $$('#tList [data-t]').forEach(b => b.onclick = async () => { if (await addItem({ service: 'transfers', searchId: r.searchId, idx: +b.dataset.t }, b)) transfersTab(); });
}

/* ---- tours & sightseeing (day-wise) ---- */
async function activitiesTab() {
  const q = S.quote, d = q.trip.destinations[S.di], k = resKey();
  $('#svcBody').innerHTML = `<div id="dayPlan"></div><div class="row" style="margin-bottom:12px;align-items:center"><div><b>${esc(d.city)}</b> · tours & sightseeing</div><div style="flex:0 0 auto" class="actions"><input id="aq" placeholder="Search tours…" style="width:220px"><button class="btn ghost sm" id="aMan">Add tour manually</button></div></div><div id="aList"></div>`;
  $('#aMan').onclick = () => manualItem('activity', `${d.city}: sightseeing`, true);
  $('#aq').oninput = drawActs;
  if (!S.res[k]) {
    $('#aList').innerHTML = loading(`Finding tours in ${d.city}`);
    try { S.res[k] = await api('POST', `/api/quotes/${q.id}/search/activities`, { destIdx: S.di }); } catch (e) { $('#aList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; drawDays(); return; }
  }
  drawDays(); drawActs();
}
function drawDays() {
  const q = S.quote, d = q.trip.destinations[S.di];
  const days = [...Array(d.nights + 1)].map((_, i) => { const x = new Date(d.checkIn + 'T00:00:00'); x.setDate(x.getDate() + i); return x.toISOString().slice(0, 10); });
  const acts = q.items.activities.filter(a => a.destIdx === S.di);
  $('#dayPlan').innerHTML = `<div class="days">${days.map((day, i) => `<div class="day"><b>Day ${q.trip.destinations.slice(0, S.di).reduce((s, x) => s + x.nights, 0) + i + 1} · ${fdw(day)}</b><div class="x">${i === 0 ? 'Arrival & check-in' : i === days.length - 1 ? 'Check-out' : 'Free day'}</div>${acts.filter(a => a.date === day).map(a => `<div class="a">${esc(a.title)} <button class="btn link tiny" data-rma="${a.id}">✕</button></div>`).join('')}</div>`).join('')}</div>`;
  $$('#dayPlan [data-rma]').forEach(b => b.onclick = () => removeItem(b.dataset.rma).then(drawDays));
}
function drawActs() {
  const r = S.res[resKey()]; if (!r || !$('#aList')) return;
  const qx = ($('#aq').value || '').toLowerCase();
  const list = r.activities.filter(a => !qx || a.title.toLowerCase().includes(qx));
  if (!list.length) { $('#aList').innerHTML = '<div class="empty">No tours found. Add one manually.</div>'; return; }
  $('#aList').innerHTML = `<div class="list">${list.slice(0, 60).map(a => `<div class="res${a.image ? '' : ' noimg'}" data-a="${a.idx}">${a.image ? `<div class="img" style="background-image:url('${esc(a.image)}')"></div>` : ''}
    <div class="bd"><h3>${esc(a.title)}</h3><p class="desc">${esc(a.description)}</p><div class="small muted">${a.duration ? '🕒 ' + esc(a.duration) : ''}</div>
      <div class="row" style="margin-top:.5rem;align-items:flex-end"><label class="f" style="flex:0 0 200px">Day<select data-day>${r.days.map((d, i) => `<option value="${d}">${fdw(d)}</option>`).join('')}</select></label><button class="btn navy sm" data-opt style="flex:0 0 auto">Show options</button></div><div data-opts></div></div>
    <div class="pr"><div class="tiny muted">From (all travellers)</div><div class="p">${pkr(a.from)}</div>${a.net ? `<div class="tiny muted">net ${money(a.net, a.netCurrency)}</div>` : ''}</div></div>`).join('')}</div>`;
  $$('#aList [data-opt]').forEach(b => b.onclick = async () => {
    const card = b.closest('.res'), idx = +card.dataset.a, date = $('[data-day]', card).value, box = $('[data-opts]', card);
    busy(b, 1, 'Checking…');
    try {
      const o = await api('POST', `/api/quotes/${S.quote.id}/activity-options`, { searchId: r.searchId, idx, date });
      box.innerHTML = o.options.length ? o.options.map(x => `<div class="opt" style="grid-template-columns:1fr auto auto"><div><b>${esc(x.modality)}</b><div class="tiny muted">${esc([x.duration, x.languages, x.cancel].filter(Boolean).join(' · '))}</div></div><div class="p">${pkr(x.sell)}</div><button class="btn red sm" data-add="${x.id}">Add</button></div>`).join('') : '<p class="small muted">Not available on this day — try another day.</p>';
      $$('[data-add]', box).forEach(x => x.onclick = async () => { if (await addItem({ service: 'activities', searchId: r.searchId, idx, date, optionId: x.dataset.add }, x)) drawDays(); });
    } catch (e) { box.innerHTML = `<p class="small" style="color:#b42318">${esc(e.message)}</p>`; } finally { busy(b, 0); }
  });
}

/* ---- extras ---- */
function extrasTab() {
  const q = S.quote;
  $('#svcBody').innerHTML = `<div class="card"><h3>Visa, insurance & other services</h3>
    ${q.items.extras.map(x => `<div class="q-item"><div><div class="t">${esc(x.title)}</div><div class="d">${esc(x.details || '')}</div></div><div class="p">${pkr(x.sellPKR)}</div><button class="btn link" data-rm="${x.id}">Remove</button></div>`).join('') || '<p class="small muted">Nothing added yet.</p>'}
    <div class="row" style="margin-top:1rem"><button class="btn ghost" data-q="Visa">+ Visa</button><button class="btn ghost" data-q="Travel insurance">+ Travel insurance</button><button class="btn ghost" data-q="Umrah / Ziyarat">+ Ziyarat</button><button class="btn ghost" data-q="">+ Other service</button></div></div>`;
  $$('#svcBody [data-rm]').forEach(b => b.onclick = () => removeItem(b.dataset.rm).then(extrasTab));
  $$('#svcBody [data-q]').forEach(b => b.onclick = () => manualItem('extra', b.dataset.q ? `${b.dataset.q} – ${q.trip.destinations.map(d => d.country).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` : ''));
}
function manualItem(kind, title, withDay) {
  const q = S.quote, d = q.trip.destinations[S.di];
  const days = d ? [...Array(d.nights + 1)].map((_, i) => { const x = new Date(d.checkIn + 'T00:00:00'); x.setDate(x.getDate() + i); return x.toISOString().slice(0, 10); }) : [];
  const curs = S.me.currencies;
  modal(`<div class="modal-h">Add ${KIND_LABEL[kind].toLowerCase()} manually</div><form class="modal-b" id="mi">
    <div class="row"><label class="f" style="flex:2">Description<input name="title" value="${esc(title)}" required></label></div>
    <div class="row" style="margin-top:.7rem"><label class="f" style="flex:2">Details (shown on the quotation)<input name="details" placeholder="e.g. room type, vehicle, inclusions"></label>${withDay ? `<label class="f">Day<select name="date">${days.map(x => `<option value="${x}">${fdw(x)}</option>`).join('')}</select></label>` : ''}</div>
    <div class="row" style="margin-top:.7rem"><label class="f">Total amount (all travellers)<input type="number" name="amount" min="0" step="any" required></label><label class="f">Currency<select name="cur">${curs.map(c => `<option>${c}</option>`).join('')}</select></label></div>
    <label class="chk" style="margin-top:.8rem"><input type="checkbox" name="final"> This is the final selling price (do not add margin)</label>
    <div class="modal-f" style="padding:1rem 0 0"><button class="btn red">Add to cart</button></div></form>`, true);
  $('#mi').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('POST', `/api/quotes/${q.id}/manual`, { kind, title: f.title.value, details: f.details.value, amount: f.amount.value, currency: f.cur.value, sellIsFinal: f.final.checked, destIdx: kind === 'extra' ? null : S.di, date: f.date ? f.date.value : '' }); S.quote = r.quote; closeModal(); refreshCart(); drawSvc(); toast('Added ✓'); }
    catch (err) { toast(err.message, 1); }
  };
}

/* ---- cart / save ---- */
function itemLine(it, q) {
  const d = it.destIdx != null && q.trip.destinations[it.destIdx];
  const sub = it.kind === 'flight' ? (it.legs ? it.legs.map(l => `${l.segments[0].from}→${l.segments[l.segments.length - 1].to} ${l.segments.map(s => s.mktg + s.flightNo).join('/')} ${fd(dmy2iso(l.segments[0].depDate))}`).join(' · ') : (it.perPax ? `Adult ${it.perPax.adt}${it.perPax.chd ? ' · Child ' + it.perPax.chd : ''}` : ''))
    : it.kind === 'hotel' ? `${d ? d.city + ' · ' : ''}${it.rooms ? it.rooms.map(r => r.roomName).join(', ') + ' · ' + (it.board || '') : it.details || ''} · ${fd(it.checkIn || (d && d.checkIn))} – ${fd(it.checkOut || (d && d.checkOut))}`
      : it.kind === 'transfer' ? `${it.vehicle || it.details || ''} ${it.date ? '· ' + fd(it.date) + ' ' + (it.time || '') : ''}`
        : it.kind === 'activity' ? `${it.modality || it.details || ''} · ${fdw(it.date)}` : it.details || '';
  return { title: it.title, sub, price: it.sellPKR };
}
function cartHtml(q, editable) {
  const groups = [['flight', q.items.flights], ['hotel', q.items.hotels], ['transfer', q.items.transfers], ['activity', q.items.activities.slice().sort((a, b) => String(a.date).localeCompare(b.date))], ['extra', q.items.extras]].filter(g => g[1].length);
  return groups.map(([k, list]) => `<div class="q-sec"><h4>${KIND_LABEL[k]}</h4>${list.map(it => { const l = itemLine(it, q); return `<div class="q-item"><div><div class="t">${esc(l.title)} ${it.source === 'manual' ? '<span class="pill">manual</span>' : ''} ${it.booking ? `<span class="pill ok">${esc(it.booking.status)}</span>` : ''}</div><div class="d">${esc(l.sub)}</div></div><div class="p">${pkr(l.price)}</div>${editable ? `<button class="btn link" data-rmc="${it.id}">Remove</button>` : '<span></span>'}</div>`; }).join('')}</div>`).join('') || '<p class="muted">Your cart is empty.</p>';
}
function priceTable(q) {
  const p = q.pricing, c = p.currency;
  return `<table class="tot">${Object.entries(p.lines).filter(([, v]) => v).map(([k, v]) => `<tr><td>${KIND_LABEL[k]}</td><td>${money(v, c)}</td></tr>`).join('')}
    ${p.agentProfit ? `<tr><td>Service charges</td><td>${money(p.agentProfit, c)}</td></tr>` : ''}
    <tr class="big"><td>TOTAL (${q.trip.pax.adt + q.trip.pax.chd + q.trip.pax.inf} travellers)</td><td>${money(p.total, c)}</td></tr><tr><td>Price per person</td><td>${money(p.perPerson, c)}</td></tr>
    ${p.profitPKR !== undefined ? `<tr><td class="muted">Supplier cost / your profit (only you see this)</td><td class="muted">${pkr(p.costPKR)} / <span style="color:var(--ok)">${pkr(p.profitPKR)}</span></td></tr>` : ''}</table>`;
}
function openCart() {
  const q = S.quote;
  modal(`<div class="modal-h">Cart details · ${esc(q.ref)}</div><div class="modal-b">
    <div class="row"><label class="f" style="flex:2">Quotation name<input id="cName" value="${esc(q.name)}"></label>
      <label class="f">Show price in<select id="cCur">${S.me.quoteCurrencies.map(c => `<option ${q.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      ${S.me.allowAgentProfit ? `<label class="f">Add your service charges<div style="display:flex;gap:.3rem"><input type="number" id="cProf" min="0" step="any" value="${q.agentProfit.value || 0}"><select id="cProfT" style="width:90px"><option value="fixed" ${q.agentProfit.type !== 'percent' ? 'selected' : ''}>PKR</option><option value="percent" ${q.agentProfit.type === 'percent' ? 'selected' : ''}>%</option></select></div></label>` : ''}</div>
    <div class="kv" style="margin-top:1rem"><div><div class="l">Pax</div><div class="v">${q.trip.pax.adt} adults, ${q.trip.pax.chd} children, ${q.trip.pax.inf} infants</div></div><div><div class="l">Dates</div><div class="v">${fd(q.trip.start)} – ${fd(q.trip.end)}</div></div><div><div class="l">Destinations</div><div class="v">${q.trip.destinations.map(d => esc(d.city)).join(', ')}</div></div></div>
    <div id="cItems">${cartHtml(q, true)}</div>
    <div id="cTot">${priceTable(q)}</div>
    <label class="f" style="margin-top:1rem">Notes for the client (optional)<textarea id="cNotes" placeholder="e.g. Hotel near KLCC, early check-in requested">${esc(q.notes || '')}</textarea></label>
  </div><div class="modal-f"><button class="btn ghost" data-close>Continue adding</button><button class="btn ghost" id="cUpd">Update price</button><button class="btn red" id="cSave">Save quotation</button></div>`);
  const upd = async () => { const r = await api('PUT', `/api/quotes/${q.id}`, { name: $('#cName').value, currency: $('#cCur').value, notes: $('#cNotes').value, ...($('#cProf') ? { agentProfit: { type: $('#cProfT').value, value: $('#cProf').value } } : {}) }); S.quote = r.quote; $('#cTot').innerHTML = priceTable(S.quote); refreshCart(); return r; };
  $('#cUpd').onclick = () => upd().catch(e => toast(e.message, 1));
  $('#cCur').onchange = $('#cUpd').onclick; if ($('#cProfT')) $('#cProfT').onchange = $('#cUpd').onclick;
  $('#cItems').onclick = async e => { if (e.target.dataset.rmc) { await removeItem(e.target.dataset.rmc); $('#cItems').innerHTML = cartHtml(S.quote, true); $('#cTot').innerHTML = priceTable(S.quote); drawSvc(); } };
  $('#cSave').onclick = async () => {
    if (!cartCount(S.quote)) return toast('Add at least one service first', 1);
    const b = $('#cSave'); busy(b, 1, 'Saving…');
    try { await upd(); const r = await api('PUT', `/api/quotes/${q.id}`, { status: 'Quoted' }); S.quote = r.quote; closeModal(); toast('Quotation saved ✓'); location.hash = 'q/' + q.id; }
    catch (e) { toast(e.message, 1); busy(b, 0); }
  };
}

/* ================= quotations list ================= */
async function quotesPage() {
  shell('quotes', '<div class="loading"><div class="spin"></div></div>');
  const draw = async () => {
    const st = $('#qs') ? $('#qs').value : '', tx = $('#qt') ? $('#qt').value : '';
    const r = await api('GET', `/api/quotes?status=${encodeURIComponent(st)}&q=${encodeURIComponent(tx)}`);
    $('#qBody').innerHTML = r.quotes.length ? r.quotes.map(q => `<tr><td class="nowrap"><a href="#q/${q.id}"><b>${esc(q.ref)}</b></a></td><td>${esc(q.name)}<div class="tiny muted">${esc(q.typeLabel)}</div></td><td>${esc(q.countries)}</td><td>${esc(q.cities)}</td><td class="nowrap">${fd(q.start)}</td><td class="nowrap">${fd(q.end)}</td><td>${q.pax.adt + q.pax.chd + q.pax.inf}</td><td class="right nowrap"><b>${money(q.total, q.currency)}</b>${q.profitPKR !== undefined ? `<div class="tiny" style="color:var(--ok)">+${pkr(q.profitPKR)}</div>` : ''}</td><td><span class="st ${stCls(q.status)}">${esc(q.status)}</span></td><td>${esc(q.owner)}</td>
      <td class="nowrap"><a class="btn ghost sm" href="#q/${q.id}">Open</a> <a class="btn ghost sm" href="print.html?id=${q.id}" target="_blank" title="PDF">PDF</a></td></tr>`).join('') : '<tr><td colspan="11" class="muted" style="text-align:center;padding:2rem">No quotations found.</td></tr>';
  };
  $('#page').innerHTML = `<div class="page-h"><div><h1>My Quotations</h1><p class="muted" style="margin:.2rem 0 0">Manage and track all your travel quotations in one place.</p></div><div class="actions"><select id="qs" style="width:auto"><option value="">All statuses</option>${['Draft', 'Quoted', 'Booking Requested', 'Processing', 'Confirmed', 'Cancelled'].map(s => `<option>${s}</option>`).join('')}</select><input id="qt" placeholder="Search name, ref, city…" style="width:240px"><a class="btn red" href="#new">+ New</a></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Ref</th><th>Name</th><th>Countries</th><th>Cities</th><th>Start</th><th>End</th><th>Pax</th><th class="right">Price</th><th>Status</th><th>By</th><th></th></tr></thead><tbody id="qBody"></tbody></table></div>`;
  $('#qs').onchange = draw; let t; $('#qt').oninput = () => { clearTimeout(t); t = setTimeout(draw, 250); };
  await draw();
}

/* ================= quotation view ================= */
async function quotePage(id) {
  shell('quotes', '<div class="loading"><div class="spin"></div></div>');
  const r = await api('GET', '/api/quotes/' + id), q = r.quote; S.quote = q; S.res = {};
  const t = q.trip;
  $('#page').innerHTML = `
    <div class="page-h"><div><div class="muted small">${esc(q.ref)} · ${TYPES[q.type][0]} · by ${esc(q.ownerName)}${q.agencyName ? ' (' + esc(q.agencyName) + ')' : ''}</div><h1>${esc(q.name)} <span class="st ${stCls(q.status)}" style="vertical-align:middle">${esc(q.status)}</span></h1></div>
      <div class="actions">
        <button class="btn green" id="waBtn">WhatsApp text</button><a class="btn navy" href="print.html?id=${q.id}" target="_blank">PDF itinerary</a>
        ${r.canEdit ? `<a class="btn ghost" href="#q/${q.id}/build">Edit services</a>` : ''}<button class="btn ghost" id="dupBtn">Duplicate</button>
        ${r.canEdit && q.status === 'Quoted' ? `<button class="btn red" id="reqBtn">Process booking</button>` : ''}
        ${r.canEdit && q.status === 'Draft' ? `<a class="btn red" href="#q/${q.id}/build">Continue costing</a>` : ''}
        ${can('process') && q.booking ? `<a class="btn red" href="#booking/${q.id}">Open in Bookings</a>` : ''}
        ${r.canEdit ? `<button class="btn ghost" id="delBtn" style="color:#b42318">Delete</button>` : ''}
      </div></div>
    <div class="grid2" style="grid-template-columns:1.5fr 1fr">
      <div class="card"><h3>Services</h3><div class="kv"><div><div class="l">Travel</div><div class="v">${fd(t.start)} – ${fd(t.end)} · ${t.nights}N</div></div><div><div class="l">Travellers</div><div class="v">${t.pax.adt} adults · ${t.pax.chd} children · ${t.pax.inf} infants</div></div><div><div class="l">Rooms</div><div class="v">${t.rooms.length}</div></div><div><div class="l">Cities</div><div class="v">${t.destinations.map(d => `${esc(d.city)} ${d.nights}N`).join(' → ')}</div></div></div>${cartHtml(q, false)}</div>
      <div><div class="card"><h3>Quotation</h3>${priceTable(q)}${q.notes ? `<p class="small" style="margin-top:.8rem"><b>Notes:</b> ${esc(q.notes)}</p>` : ''}</div>
      ${q.booking ? `<div class="card" style="margin-top:14px"><h3>Booking request</h3><div class="small">Requested ${fd(q.booking.requestedAt)} by ${esc(q.booking.requestedBy)}</div><div class="small" style="margin-top:.4rem">${q.booking.pax.map(p => `${esc(p.salutation)} ${esc(p.givenName)} ${esc(p.surName)} (${p.paxType})`).join('<br>')}</div>${(q.booking.log || []).length ? `<div class="small muted" style="margin-top:.6rem">${q.booking.log.slice(-6).map(l => `${fd(l.at)} · ${esc(l.item || l.action)}: ${esc(l.status)}`).join('<br>')}</div>` : ''}</div>` : ''}</div>
    </div>`;
  $('#waBtn').onclick = () => { const txt = waText(q); modal(`<div class="modal-h">WhatsApp text</div><div class="modal-b"><div class="wa" id="waT">${esc(txt)}</div></div><div class="modal-f"><button class="btn ghost" id="cpy">Copy text</button><a class="btn green" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(txt)}">Open WhatsApp</a></div>`); $('#cpy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('Copied ✓')).catch(() => toast('Select the text and copy', 1)); };
  $('#dupBtn').onclick = async () => { const x = await api('POST', `/api/quotes/${q.id}/duplicate`); S.quote = x.quote; toast('Duplicated'); location.hash = `q/${x.quote.id}/build`; };
  if ($('#delBtn')) $('#delBtn').onclick = async () => { if (!confirm('Delete this quotation?')) return; await api('DELETE', '/api/quotes/' + q.id); toast('Deleted'); location.hash = 'quotes'; };
  if ($('#reqBtn')) $('#reqBtn').onclick = () => requestBooking(q);
}
function waText(q) {
  const t = q.trip, c = q.pricing.currency, L = [];
  L.push(`*${q.name}*`, `🗓 Travel Date: ${fd(t.start)} – ${fd(t.end)} (${t.nights} nights)`, `👥 Passengers: ${t.pax.adt} Adult${t.pax.adt > 1 ? 's' : ''}${t.pax.chd ? `, ${t.pax.chd} Child` : ''}${t.pax.inf ? `, ${t.pax.inf} Infant` : ''}`, '');
  if (q.items.flights.length) { L.push('✈️ *Flights*'); q.items.flights.forEach(f => { if (f.legs) f.legs.forEach(l => { const a = l.segments[0], b = l.segments[l.segments.length - 1]; L.push(`• ${l.segments.map(s => s.mktg + ' ' + s.flightNo).join(' / ')} ${a.from}→${b.to} ${fd(dmy2iso(a.depDate))} ${hm(a.depTime)}–${hm(b.arrTime)}`); }); else L.push(`• ${f.title}`); }); L.push(''); }
  if (q.items.hotels.length) { L.push('🏨 *Hotels & Stay*'); q.items.hotels.forEach((h, i) => { const d = t.destinations[h.destIdx] || {}; L.push(`${i + 1}. ${d.city || ''}: ${h.title} / Similar`, `   • ${h.rooms ? h.rooms.map(r => r.roomName).join(', ') : h.details || ''}${h.board ? ' on ' + h.board : ''} (${h.nights || d.nights} Nights)`); }); L.push(''); }
  if (q.items.activities.length) { L.push('🎡 *Tours & Activities*'); q.items.activities.slice().sort((a, b) => String(a.date).localeCompare(b.date)).forEach(a => L.push(`• ${a.date ? fdw(a.date) + ': ' : ''}${a.title}${a.modality ? ' – ' + a.modality : ''}`)); L.push(''); }
  if (q.items.transfers.length) { L.push('🚐 *Transfers*'); q.items.transfers.forEach(x => L.push(`• ${x.title}`)); L.push(''); }
  if (q.items.extras.length) { L.push('➕ *Also included*'); q.items.extras.forEach(x => L.push(`• ${x.title}`)); L.push(''); }
  L.push(`💰 *Price per person: ${money(q.pricing.perPerson, c)}*`, `Total: ${money(q.pricing.total, c)}`, '');
  L.push('📌 *Notes:*'); (S.me.notes || []).forEach(n => L.push('✓ ' + n));
  L.push('', '❌ *Excludes:*'); (S.me.excludes || []).forEach(n => L.push('• ' + n));
  if (!q.items.flights.length) L.push('• Flight tickets (quoted separately on request)');
  const a = S.me.user.agency || {}, co = S.me.company;
  L.push('', `${a.name || co.name}${a.phone || co.phone ? ' · ' + (a.phone || co.phone) : ''}`);
  return L.join('\n');
}
function requestBooking(q) {
  const t = q.trip, people = [...Array(t.pax.adt)].map((_, i) => ['ADT', 'Adult ' + (i + 1)]).concat([...Array(t.pax.chd)].map((_, i) => ['CHD', 'Child ' + (i + 1)])).concat([...Array(t.pax.inf)].map((_, i) => ['INF', 'Infant ' + (i + 1)]));
  const titles = { ADT: ['Mr', 'Mrs', 'Ms'], CHD: ['Mstr', 'Miss'], INF: ['Mstr', 'Miss'] };
  modal(`<div class="modal-h">Process booking · ${esc(q.ref)}</div><form class="modal-b" id="rb">
    <div class="notice info">Enter traveller names exactly as on passports. The booking team will confirm each service and share the vouchers / e-tickets.</div>
    ${people.map(([pt, l], i) => `<div class="card" style="box-shadow:none;border:1px solid var(--line);margin-bottom:.6rem"><b>${l}${i === 0 ? ' <span class="pill red">Lead</span>' : ''}</b>
      <div class="row" style="margin-top:.5rem"><label class="f" style="flex:0 0 100px">Title<select name="sal${i}">${titles[pt].map(x => `<option>${x}</option>`).join('')}</select></label><label class="f">First name<input name="gn${i}" required pattern="[A-Za-z ]+"></label><label class="f">Last name<input name="sn${i}" required pattern="[A-Za-z ]+"></label><label class="f">Date of birth<input type="date" name="dob${i}" ${pt !== 'ADT' ? 'required' : ''}></label></div>
      <div class="row" style="margin-top:.5rem"><label class="f">Nationality<select name="nat${i}">${NATS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label><label class="f">Passport no.<input name="pp${i}" pattern="[A-Za-z0-9]{5,15}"></label><label class="f">Passport expiry<input type="date" name="px${i}"></label></div><input type="hidden" name="pt${i}" value="${pt}"></div>`).join('')}
    <div class="row"><label class="f">Contact name<input name="cn" required></label><label class="f">Mobile<input name="cp" required></label><label class="f">Email<input type="email" name="ce"></label></div>
    <label class="f" style="margin-top:.7rem">Remarks for the booking team<textarea name="rm" placeholder="Special requests, payment status, etc."></textarea></label>
    <div class="modal-f" style="padding:1rem 0 0"><button class="btn red lg">Send booking request</button></div></form>`);
  $('#rb').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.red');
    const pax = people.map((_, i) => ({ paxType: f['pt' + i].value, salutation: f['sal' + i].value, givenName: f['gn' + i].value, surName: f['sn' + i].value, birthDate: f['dob' + i].value, nationality: f['nat' + i].value, passportNo: f['pp' + i].value, passportExpiry: f['px' + i].value }));
    busy(b, 1, 'Sending…');
    try { await api('POST', `/api/quotes/${q.id}/request-booking`, { pax, contact: { name: f.cn.value, phone: f.cp.value, email: f.ce.value }, remarks: f.rm.value }); closeModal(); toast('Booking request sent ✓'); quotePage(q.id); refreshPending(); }
    catch (err) { toast(err.message, 1); busy(b, 0); }
  };
}

/* ================= bookings (processing) ================= */
async function bookingsPage() {
  shell('bookings', '<div class="loading"><div class="spin"></div></div>');
  const r = await api('GET', '/api/bookings');
  S.pendingCount = r.bookings.filter(b => b.status === 'Booking Requested').length;
  shell('bookings');
  $('#page').innerHTML = `<div class="page-h"><div><h1>Bookings</h1><p class="muted" style="margin:.2rem 0 0">Booking requests from your team and agents.</p></div></div>
    <div class="kpis"><div class="kpi"><div class="l">New requests</div><div class="v">${S.pendingCount}</div></div><div class="kpi"><div class="l">Processing</div><div class="v">${r.bookings.filter(b => b.status === 'Processing').length}</div></div><div class="kpi"><div class="l">Confirmed</div><div class="v">${r.bookings.filter(b => b.status === 'Confirmed').length}</div></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Requested</th><th>Ref</th><th>Name</th><th>Agent / agency</th><th>Cities</th><th>Start</th><th>Pax</th><th class="right">Total</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>
    ${r.bookings.map(b => `<tr><td class="nowrap">${fd(b.requestedAt)}</td><td><b>${esc(b.ref)}</b></td><td>${esc(b.name)}</td><td>${esc(b.owner)}${b.agency ? `<div class="tiny muted">${esc(b.agency)}</div>` : ''}</td><td>${esc(b.cities)}</td><td class="nowrap">${fd(b.start)}</td><td>${b.pax.adt + b.pax.chd + b.pax.inf}</td><td class="right nowrap"><b>${money(b.total, b.currency)}</b></td><td>${b.done}/${b.items} booked</td><td><span class="st ${stCls(b.status)}">${esc(b.status)}</span></td><td><a class="btn red sm" href="#booking/${b.id}">Process</a></td></tr>`).join('') || '<tr><td colspan="11" class="muted" style="text-align:center;padding:2rem">No booking requests yet.</td></tr>'}</tbody></table></div>`;
}
async function processPage(id) {
  shell('bookings', '<div class="loading"><div class="spin"></div></div>');
  const q = (await api('GET', '/api/quotes/' + id)).quote, bk = q.booking;
  const items = ['flights', 'hotels', 'transfers', 'activities', 'extras'].flatMap(k => q.items[k]);
  $('#page').innerHTML = `<div class="page-h"><div><div class="muted small">${esc(q.ref)} · requested by ${esc(bk.requestedBy)} on ${fd(bk.requestedAt)}</div><h1>${esc(q.name)} <span class="st ${stCls(q.status)}">${esc(q.status)}</span></h1></div>
    <div class="actions"><a class="btn ghost" href="print.html?id=${q.id}" target="_blank">PDF</a><button class="btn green" data-st="Confirmed">Mark whole booking confirmed</button><button class="btn ghost" data-st="Cancelled" style="color:#b42318">Cancel booking</button></div></div>
    <div class="grid2" style="grid-template-columns:1.6fr 1fr">
      <div class="card"><h3>Services to book</h3>${items.map(it => { const l = itemLine(it, q), b = it.booking; return `<div class="proc-item"><div><div><span class="pill">${KIND_LABEL[it.kind]}</span> <b>${esc(l.title)}</b> ${it.source === 'manual' ? '<span class="pill">manual</span>' : ''}</div><div class="small muted">${esc(l.sub)}</div>
        <div class="small" style="margin-top:.3rem">Sell ${pkr(it.sellPKR)}${it.net != null ? ` · net ${money(it.net, it.currency)}` : ''}</div>
        ${b ? `<div class="small" style="margin-top:.3rem"><span class="pill ${/CANCEL/i.test(b.status) ? 'no' : 'ok'}">${esc(b.status)}</span> ${b.pnr ? 'PNR <b>' + esc(b.pnr) + '</b> · ' : ''}${b.supplierRef ? 'Ref <b>' + esc(b.supplierRef) + '</b>' : ''} ${b.tickets ? '· ' + esc(b.tickets) : ''} <span class="muted">by ${esc(b.by)} ${fd(b.at)}</span>${b.ticketingTimeLimit ? `<div class="tiny" style="color:var(--warn)">Ticketing time limit: ${esc(b.ticketingTimeLimit)}</div>` : ''}${b.priceChange ? `<div class="tiny" style="color:var(--warn)">Supplier price changed: ${b.priceChange.from} → ${b.priceChange.to} ${esc(b.priceChange.currency)}</div>` : ''}</div>` : ''}</div>
        <div class="actions" style="flex-direction:column;align-items:stretch">${!b || /CANCEL|fail/i.test(b.status) ? `${it.source !== 'manual' ? `<button class="btn red sm" data-a="book" data-i="${it.id}">${it.kind === 'flight' ? 'Hold PNR via API' : 'Book via API'}</button>` : ''}<button class="btn ghost sm" data-a="manual" data-i="${it.id}">Mark confirmed</button>` : `${it.kind === 'flight' && !/TICKET/i.test(b.status) && it.source !== 'manual' ? `<button class="btn red sm" data-a="issue" data-i="${it.id}">Issue ticket</button>` : ''}<button class="btn ghost sm" data-a="manual" data-i="${it.id}">Edit reference</button><button class="btn ghost sm" data-a="cancel" data-i="${it.id}" style="color:#b42318">Cancel</button>`}</div></div>`; }).join('')}</div>
      <div><div class="card"><h3>Travellers</h3>${bk.pax.map(p => `<div class="small" style="padding:.3rem 0;border-bottom:1px solid var(--line)"><b>${esc(p.salutation)} ${esc(p.givenName)} ${esc(p.surName)}</b> (${p.paxType}) · DOB ${esc(p.birthDate || '-')} · ${esc(p.nationality)} · PP ${esc(p.passportNo || '-')} ${p.passportExpiry ? 'exp ' + esc(p.passportExpiry) : ''}</div>`).join('')}
        <div class="small" style="margin-top:.6rem"><b>Contact:</b> ${esc(bk.contact.name)} · ${esc(bk.contact.phone)} · ${esc(bk.contact.email)}</div>${bk.remarks ? `<div class="small" style="margin-top:.4rem"><b>Remarks:</b> ${esc(bk.remarks)}</div>` : ''}</div>
        <div class="card" style="margin-top:14px"><h3>Price</h3>${priceTable(q)}</div>
        <div class="card" style="margin-top:14px"><h3>Activity log</h3><div class="small muted">${(bk.log || []).map(l => `${new Date(l.at).toLocaleString('en-GB')} · ${esc(l.by)} · ${esc(l.item || '')} ${esc(l.action)} → ${esc(l.status)} ${esc(l.ref || '')}`).join('<br>') || 'Nothing yet.'}</div></div></div></div>`;
  $$('#page [data-st]').forEach(b => b.onclick = async () => { if (!confirm(`Set booking to "${b.dataset.st}"?`)) return; await api('POST', `/api/quotes/${q.id}/status`, { status: b.dataset.st }); toast('Updated'); processPage(id); refreshPending(); });
  $$('#page [data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a, it = items.find(x => x.id === b.dataset.i);
    let body = { action: a };
    if (a === 'manual') {
      const ref = prompt(it.kind === 'flight' ? 'PNR (and ticket numbers after a comma, optional):' : 'Supplier confirmation / reference number:', it.booking ? (it.booking.pnr || it.booking.supplierRef || '') : '');
      if (ref === null) return;
      body = it.kind === 'flight' ? { action: 'manual', pnr: ref.split(',')[0].trim(), tickets: ref.split(',').slice(1).join(',').trim(), status: ref.includes(',') ? 'TICKETED (manual)' : 'HK (manual)' } : { action: 'manual', supplierRef: ref, status: 'CONFIRMED (manual)' };
    }
    if (a === 'book' && it.kind === 'transfer' && !it.flightCode) { const fc = prompt(`Flight number for this ${it.direction === 'DEPARTURE' ? 'departure' : 'arrival'} transfer (e.g. EK601):`); if (!fc) return; body.flightCode = fc; }
    if (a === 'book' && !confirm(`${it.kind === 'flight' ? 'Create the airline booking (PNR on hold)' : 'Book this with the supplier'} now? This creates a real reservation on your account.`)) return;
    if (a === 'issue' && !confirm('Issue the ticket now? This charges your agency credit. Make sure payment is received.')) return;
    if (a === 'cancel' && !confirm('Cancel this service? Cancellation charges may apply.')) return;
    busy(b, 1, 'Working…');
    try { const r = await api('POST', `/api/quotes/${q.id}/process/${it.id}`, body); toast(`${it.title}: ${r.result.status}`); processPage(id); }
    catch (e) { toast(e.message, 1); busy(b, 0); }
  });
}

/* ================= admin: users ================= */
async function usersPage() {
  shell('admin/users', '<div class="loading"><div class="spin"></div></div>');
  const r = await api('GET', '/api/admin/users');
  $('#page').innerHTML = `<div class="page-h"><div><h1>Team & Agents</h1><p class="muted" style="margin:.2rem 0 0">Create logins for your team and network agents. Each agent's logo and agency details print on their PDFs.</p></div><button class="btn red" id="newU">+ New user</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Logo</th><th>Name</th><th>Username</th><th>Role</th><th>Agency</th><th>Phone</th><th>Margins</th><th>Permissions</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
    ${r.users.map(u => `<tr><td>${u.agency && u.agency.logo ? `<img src="${u.agency.logo}" style="height:32px;max-width:90px;object-fit:contain">` : '<span class="muted tiny">—</span>'}</td><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td><span class="pill ${u.role === 'admin' ? 'red' : ''}">${esc(u.role)}</span></td><td>${esc(u.agency && u.agency.name)}</td><td>${esc(u.agency && u.agency.phone)}</td><td class="small">${u.margins && Object.keys(u.margins).length ? Object.entries(u.margins).map(([k, v]) => `${k} ${v}%`).join(', ') : '<span class="muted">default</span>'}</td><td class="small">${[u.canProcessBookings && 'process bookings', u.canSeeNet && 'see net', u.canSeeAllQuotations && 'all quotes'].filter(Boolean).join(', ') || '—'}</td><td>${u.active ? '<span class="pill ok">Active</span>' : '<span class="pill no">Disabled</span>'}</td><td class="small nowrap">${u.lastLogin ? fd(u.lastLogin) : '—'}</td><td><button class="btn ghost sm" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#newU').onclick = () => userForm(null);
  $$('#page [data-u]').forEach(b => b.onclick = () => userForm(r.users.find(u => u.id === b.dataset.u)));
}
function readLogo(file, cb) {
  const img = new Image(), rd = new FileReader();
  rd.onload = () => { img.onload = () => { const s = Math.min(1, 360 / img.width, 160 / img.height), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); let d = c.toDataURL('image/png'); if (d.length > 44000) d = c.toDataURL('image/jpeg', 0.85); if (d.length > 44000) return toast('Logo too large — use a smaller image', 1); cb(d); }; img.src = rd.result; };
  rd.readAsDataURL(file);
}
function userForm(u) {
  const a = (u && u.agency) || {}, m = (u && u.margins) || {};
  let logo = a.logo || '';
  modal(`<div class="modal-h">${u ? 'Edit ' + esc(u.name) : 'New user'}</div><form class="modal-b" id="uf">
    <div class="sec" style="margin-top:0">Login</div>
    <div class="row"><label class="f">Full name<input name="name" value="${esc(u ? u.name : '')}" required></label><label class="f">Username<input name="username" value="${esc(u ? u.username : '')}" ${u ? 'disabled' : 'required'} pattern="[a-zA-Z0-9._-]{3,30}"></label><label class="f">${u ? 'New password (leave empty to keep)' : 'Password (min 8)'}<input name="password" type="text" ${u ? '' : 'required'} minlength="8" autocomplete="new-password"></label>
      <label class="f">Role<select name="role"><option value="agent" ${u && u.role === 'agent' ? 'selected' : ''}>Agent (network / sub-agent)</option><option value="staff" ${u && u.role === 'staff' ? 'selected' : ''}>Staff (team member)</option><option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label></div>
    <div class="row" style="margin-top:.6rem"><label class="chk"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''}> Active</label><label class="chk"><input type="checkbox" name="proc" ${u && u.canProcessBookings ? 'checked' : ''}> Can process bookings</label><label class="chk"><input type="checkbox" name="net" ${u && u.canSeeNet ? 'checked' : ''}> Can see supplier net prices & profit</label><label class="chk"><input type="checkbox" name="all" ${u && u.canSeeAllQuotations ? 'checked' : ''}> Can see everyone's quotations</label></div>
    <div class="sec">Agency details (printed on their PDF quotations)</div>
    <div class="row"><label class="f">Agency name<input name="an" value="${esc(a.name)}"></label><label class="f">Phone / WhatsApp<input name="ap" value="${esc(a.phone)}"></label><label class="f">Email<input name="ae" value="${esc(a.email)}"></label></div>
    <div class="row" style="margin-top:.6rem"><label class="f" style="flex:2">Address<input name="aa" value="${esc(a.address)}"></label><label class="f">Website<input name="aw" value="${esc(a.website)}"></label><div style="flex:0 0 auto"><div class="tiny muted" style="font-weight:800;margin-bottom:.3rem">LOGO</div><div style="display:flex;gap:.5rem;align-items:center"><div class="logo-prev" id="lp" style="${logo ? `background-image:url('${logo}')` : ''}">${logo ? '' : 'No logo'}</div><input type="file" id="lf" accept="image/*" style="width:190px"></div></div></div>
    <div class="sec">Margin override % (empty = use default from Margins & Settings)</div>
    <div class="row">${['flight', 'hotel', 'transfer', 'activity', 'extra'].map(k => `<label class="f">${KIND_LABEL[k]}<input type="number" step="any" name="m_${k}" value="${m[k] != null ? m[k] : ''}" placeholder="default"></label>`).join('')}</div>
    <div class="modal-f" style="padding:1.2rem 0 0"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn red">Save user</button></div></form>`);
  $('#lf').onchange = e => e.target.files[0] && readLogo(e.target.files[0], d => { logo = d; $('#lp').style.backgroundImage = `url('${d}')`; $('#lp').textContent = ''; });
  $('#uf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const body = { name: f.name.value, role: f.role.value, active: f.active.checked, canProcessBookings: f.proc.checked, canSeeNet: f.net.checked, canSeeAllQuotations: f.all.checked, agency: { name: f.an.value, phone: f.ap.value, email: f.ae.value, address: f.aa.value, website: f.aw.value, logo }, margins: Object.fromEntries(['flight', 'hotel', 'transfer', 'activity', 'extra'].map(k => [k, f['m_' + k].value])) };
    if (f.password.value) body.password = f.password.value;
    try { if (u) await api('PUT', '/api/admin/users/' + u.id, body); else await api('POST', '/api/admin/users', { ...body, username: f.username.value }); closeModal(); toast('Saved ✓'); usersPage(); }
    catch (err) { toast(err.message, 1); }
  };
}

/* ================= admin: settings ================= */
async function settingsPage() {
  shell('admin/settings', '<div class="loading"><div class="spin"></div></div>');
  const r = await api('GET', '/api/admin/settings'), s = r.settings; S.fx = s.fx;
  let logo = s.company.logo || '';
  $('#page').innerHTML = `<div class="page-h"><div><h1>Margins & Settings</h1><p class="muted" style="margin:.2rem 0 0">Storage: ${esc(r.storage)}${r.pendingWrites ? ` · ${r.pendingWrites} changes waiting to save` : ''}</p></div><button class="btn red" id="saveS">Save settings</button></div>
    <div class="grid2">
      <div class="card"><h3>Default margin % (added on supplier net price)</h3><div class="row">${['flight', 'hotel', 'transfer', 'activity', 'extra'].map(k => `<label class="f">${KIND_LABEL[k]}<input type="number" step="any" data-m="${k}" value="${s.margins[k]}"></label>`).join('')}</div>
        <p class="small muted">Override margins for a specific agent in <b>Team & Agents</b>. Agents never see net prices unless you allow it.</p>
        <label class="chk" style="margin-top:.6rem"><input type="checkbox" id="aap" ${s.allowAgentProfit ? 'checked' : ''}> Let users add their own service charges on top</label>
        <div class="row" style="margin-top:.8rem"><label class="f">Quotation valid (hours)<input type="number" id="vh" value="${s.validityHours}"></label><label class="f">Quote currencies (comma separated)<input id="qc" value="${esc(s.quoteCurrencies.join(','))}"></label></div></div>
      <div class="card"><h3>Exchange rates (1 unit = PKR)</h3><p class="small muted" style="margin-top:-.4rem">Supplier prices come in USD/EUR/etc. Update these regularly.${s.fxUpdatedAt ? ' Last updated ' + fd(s.fxUpdatedAt) : ''}</p>
        <div class="row" id="fx">${Object.entries(s.fx).filter(([k]) => k !== 'PKR').map(([k, v]) => `<label class="f" style="flex:0 0 110px">${k}<input type="number" step="any" data-fx="${k}" value="${v}"></label>`).join('')}</div>
        <div class="row" style="margin-top:.6rem"><label class="f" style="flex:0 0 110px">Add currency<input id="nfc" maxlength="3" placeholder="e.g. TRY" style="text-transform:uppercase"></label><label class="f" style="flex:0 0 110px">Rate<input id="nfr" type="number" step="any"></label><button class="btn ghost sm" id="addFx" style="flex:0 0 auto">Add</button></div></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3>Company (default branding for PDFs)</h3>
        <div class="row"><label class="f">Company name<input id="cn" value="${esc(s.company.name)}"></label><label class="f">Phone<input id="cp" value="${esc(s.company.phone)}"></label></div>
        <div class="row" style="margin-top:.6rem"><label class="f">Email<input id="ce" value="${esc(s.company.email)}"></label><label class="f">Website<input id="cw" value="${esc(s.company.website)}"></label></div>
        <div class="row" style="margin-top:.6rem"><label class="f" style="flex:2">Address<input id="ca" value="${esc(s.company.address)}"></label><div style="flex:0 0 auto"><div class="tiny muted" style="font-weight:800;margin-bottom:.3rem">LOGO</div><div style="display:flex;gap:.5rem;align-items:center"><div class="logo-prev" id="clp" style="${logo ? `background-image:url('${logo}')` : ''}">${logo ? '' : 'No logo'}</div><input type="file" id="clf" accept="image/*" style="width:190px"></div></div></div></div>
      <div class="card"><h3>Quotation notes & excludes (one per line)</h3><label class="f">Notes<textarea id="nt" rows="5">${esc(s.notes.join('\n'))}</textarea></label><label class="f" style="margin-top:.6rem">Excludes<textarea id="ex" rows="3">${esc(s.excludes.join('\n'))}</textarea></label></div>
    </div>`;
  $('#clf').onchange = e => e.target.files[0] && readLogo(e.target.files[0], d => { logo = d; $('#clp').style.backgroundImage = `url('${d}')`; $('#clp').textContent = ''; });
  $('#addFx').onclick = () => { const c = $('#nfc').value.toUpperCase(), v = $('#nfr').value; if (!/^[A-Z]{3}$/.test(c) || !(+v > 0)) return toast('Enter a 3-letter code and rate', 1); $('#fx').insertAdjacentHTML('beforeend', `<label class="f" style="flex:0 0 110px">${c}<input type="number" step="any" data-fx="${c}" value="${v}"></label>`); $('#nfc').value = $('#nfr').value = ''; };
  $('#saveS').onclick = async () => {
    const body = { margins: Object.fromEntries($$('[data-m]').map(i => [i.dataset.m, i.value])), fx: Object.fromEntries($$('[data-fx]').map(i => [i.dataset.fx, i.value])), allowAgentProfit: $('#aap').checked, validityHours: $('#vh').value, quoteCurrencies: $('#qc').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean).concat('PKR').filter((v, i, a) => a.indexOf(v) === i),
      company: { name: $('#cn').value, phone: $('#cp').value, email: $('#ce').value, website: $('#cw').value, address: $('#ca').value, logo }, notes: $('#nt').value.split('\n').map(x => x.trim()).filter(Boolean), excludes: $('#ex').value.split('\n').map(x => x.trim()).filter(Boolean) };
    try { await api('PUT', '/api/admin/settings', body); S.me = null; toast('Settings saved ✓'); render(); } catch (e) { toast(e.message, 1); }
  };
}

/* ================= admin: destinations ================= */
async function destPage() {
  shell('admin/destinations', '<div class="loading"><div class="spin"></div></div>');
  const r = await api('GET', '/api/admin/destinations');
  $('#page').innerHTML = `<div class="page-h"><div><h1>Destinations</h1><p class="muted" style="margin:.2rem 0 0">Cities your team can choose. <b>Airport</b> is used for flights & transfers, <b>Tours code</b> is the Hotelbeds destination code for sightseeing, <b>lat/lng</b> for hotel search.</p></div><button class="btn red" id="newD">+ Add destination</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Country</th><th>City</th><th>Airport</th><th>Tours code</th><th>Latitude</th><th>Longitude</th><th>Hotel radius km</th><th>Active</th><th></th></tr></thead><tbody>${r.destinations.map(d => `<tr><td>${esc(d.country)}</td><td><b>${esc(d.city)}</b></td><td>${esc(d.iata)}</td><td>${esc(d.hbDest)}</td><td>${d.lat}</td><td>${d.lng}</td><td>${d.radius}</td><td>${d.active === false ? '<span class="pill no">No</span>' : '<span class="pill ok">Yes</span>'}</td><td class="nowrap"><button class="btn ghost sm" data-e="${d.id}">Edit</button> <button class="btn ghost sm" data-x="${d.id}" style="color:#b42318">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = d => {
    d = d || { active: true, radius: 15 };
    modal(`<div class="modal-h">${d.id ? 'Edit' : 'Add'} destination</div><form class="modal-b" id="df"><div class="row"><label class="f">Country<input name="country" value="${esc(d.country || '')}" required></label><label class="f">City<input name="city" value="${esc(d.city || '')}" required></label><label class="f">Airport (IATA)<input name="iata" value="${esc(d.iata || '')}" maxlength="3" required style="text-transform:uppercase"></label></div>
      <div class="row" style="margin-top:.6rem"><label class="f">Tours code (Hotelbeds)<input name="hbDest" value="${esc(d.hbDest || '')}" maxlength="5" style="text-transform:uppercase"></label><label class="f">Latitude<input name="lat" type="number" step="any" value="${d.lat != null ? d.lat : ''}" required></label><label class="f">Longitude<input name="lng" type="number" step="any" value="${d.lng != null ? d.lng : ''}" required></label><label class="f">Hotel radius km<input name="radius" type="number" value="${d.radius}"></label></div>
      <label class="chk" style="margin-top:.7rem"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}> Active</label><p class="tiny muted">Tip: find latitude/longitude by right-clicking the city centre in Google Maps.</p>
      <div class="modal-f" style="padding:1rem 0 0"><button class="btn red">Save</button></div></form>`, true);
    $('#df').onsubmit = async e => { e.preventDefault(); const f = e.target; try { await api('POST', '/api/admin/destinations', { id: d.id, country: f.country.value, city: f.city.value, iata: f.iata.value.toUpperCase(), hbDest: f.hbDest.value.toUpperCase(), lat: f.lat.value, lng: f.lng.value, radius: f.radius.value, active: f.active.checked }); S.me = null; closeModal(); toast('Saved ✓'); destPage(); } catch (err) { toast(err.message, 1); } };
  };
  $('#newD').onclick = () => form(null);
  $$('#page [data-e]').forEach(b => b.onclick = () => form(r.destinations.find(d => d.id === b.dataset.e)));
  $$('#page [data-x]').forEach(b => b.onclick = async () => { if (!confirm('Delete this destination?')) return; await api('DELETE', '/api/admin/destinations/' + b.dataset.x); S.me = null; destPage(); });
}

boot();
