/* app.js - PAHINA public site + member area.
 * A static single-page app (hash routes like #/books) so it works on GitHub Pages. Data comes from Supabase.
 * NOTE: the checks here (needLogin / needAdmin) only decide what to SHOW. The real security is Row Level Security in sql/supabase_schema.sql. */
(() => {
'use strict';
const C = window.PAHINA;
const sb = window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' } }) : null;
const state = { profile: null };
const APP = window.APP = { sb, C, state, routes: {} };
const R = APP.routes;

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '...' : s; };
const fmtDate = d => d ? new Date(/^\d{4}-\d\d-\d\d$/.test(d) ? d + 'T00:00:00' : d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const fileUrl = p => p ? sb.storage.from('uploads').getPublicUrl(p).data.publicUrl : null;
const spinner = '<div class="text-center py-5"><div class="spinner-border text-secondary"></div></div>';
const must = (...rs) => { for (const r of rs) if (r.error) throw r.error; return rs; };
const view = html => { $('#view').innerHTML = html; };
const alertHtml = (msg, type = 'danger') => `<div class="alert alert-${type}">${esc(msg)}</div>`;
const opts = (list, sel) => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const hero = (t, s = '') => `<section class="page-hero"><div class="container"><h1>${esc(t)}</h1>${s ? `<p>${esc(s)}</p>` : ''}</div></section>`;
const wrap = inner => `<div class="container py-5">${inner}</div>`;
const empty = text => `<div class="empty-state"><i class="bi bi-journal-x"></i><p>${esc(text)}</p></div>`;
const grid = (items, col = 'col-md-6 col-lg-4') => items.length ? `<div class="row g-4">${items.map(i => `<div class="${col}">${i}</div>`).join('')}</div>` : '';
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

const BADGES = { available: 'success', borrowed: 'danger', reserved: 'warning text-dark', planned: 'secondary', ongoing: 'primary', completed: 'success', cancelled: 'dark',
  published: 'success', draft: 'secondary', active: 'success', inactive: 'danger', admin: 'danger', member: 'info text-dark', pending: 'secondary', approved: 'success', rejected: 'danger' };
const badge = s => `<span class="badge bg-${BADGES[String(s).toLowerCase()] || 'secondary'}">${esc(cap(s))}</span>`;

function toast(type, msg) {
  const el = document.createElement('div');
  el.className = `alert alert-${type} alert-dismissible shadow`;
  el.innerHTML = esc(msg) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
  $('#toasts').append(el); setTimeout(() => el.remove(), 7000);
}
function modal(title, body, size = '') {
  const m = $('#appModal'); $('.modal-title', m).textContent = title; $('.modal-body', m).innerHTML = body;
  $('.modal-dialog', m).className = 'modal-dialog modal-dialog-scrollable ' + size;
  bootstrap.Modal.getOrCreateInstance(m).show(); return m;
}
const closeModal = () => bootstrap.Modal.getOrCreateInstance($('#appModal')).hide();

// "View details" popup. The data is stored (escaped) in the button's data-detail attribute.
const detailBtn = (title, fields, img = null, link = null, label = 'View', cls = 'btn-outline-maroon') =>
  `<button type="button" class="btn btn-sm ${cls}" data-detail="${esc(JSON.stringify({ title, fields, img, link }))}">${esc(label)}</button>`;
function showDetail(d) {
  let h = d.img ? `<img src="${esc(d.img)}" class="img-fluid rounded mb-3" alt="">` : '';
  h += '<dl class="row mb-0">';
  for (const [k, v] of d.fields) if (v !== null && v !== undefined && v !== '') h += `<dt class="col-sm-4">${esc(k)}</dt><dd class="col-sm-8">${esc(v).replace(/\n/g, '<br>')}</dd>`;
  h += '</dl>';
  if (d.link) h += `<a class="btn btn-maroon mt-3" target="_blank" rel="noopener" href="${esc(d.link[1])}">${esc(d.link[0])}</a>`;
  modal(d.title, h, 'modal-lg');
}

document.addEventListener('click', async e => {
  const d = e.target.closest('[data-detail]');
  if (d) return showDetail(JSON.parse(d.dataset.detail));
  const l = e.target.closest('[data-lightbox]');
  if (l) { e.preventDefault(); const m = $('#lbModal'); $('img', m).src = l.dataset.lightbox; $('.modal-title', m).textContent = l.dataset.title || ''; bootstrap.Modal.getOrCreateInstance(m).show(); return; }
  if (e.target.closest('[data-act="logout"]')) { await sb.auth.signOut(); state.profile = null; toast('success', 'You have been logged out.'); go('#/login'); }
});

/* ---------- uploads (admin only: Storage policies enforce this on the server) ---------- */
async function upload(file, folder) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const { error } = await sb.storage.from('uploads').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error; return path;
}
const removeFiles = async paths => { paths = paths.filter(Boolean); if (paths.length) await sb.storage.from('uploads').remove(paths); };
function checkFile(file, kind) {   // kind: 'image' (3 MB) or 'doc' (5 MB)
  const ext = file.name.split('.').pop().toLowerCase();
  if (kind === 'image') {
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) || !file.type.startsWith('image/')) throw new Error(file.name + ': only JPG, PNG, WEBP or GIF images are allowed.');
    if (file.size > 3 * 1048576) throw new Error(file.name + ': image is too large (max 3 MB).');
  } else {
    if (!['pdf', 'doc', 'docx'].includes(ext)) throw new Error(file.name + ': only PDF, DOC or DOCX documents are allowed.');
    if (file.size > 5 * 1048576) throw new Error(file.name + ': document is too large (max 5 MB).');
  }
}

/* ---------- session ---------- */
async function setSession(session) {
  state.profile = null;
  if (!session) return;
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (data && data.status === 'active') state.profile = data;
  else { await sb.auth.signOut(); if (data) toast('danger', 'Your account is deactivated. Please contact the administrator.'); }
}
function needLogin() { if (!state.profile) { toast('warning', 'Please log in to continue.'); go('#/login'); return false; } return true; }
function needAdmin() {
  if (!needLogin()) return false;
  if (state.profile.role !== 'admin') { toast('danger', 'You are not allowed to open that page.'); go('#/dashboard'); return false; }
  return true;
}

/* ---------- reusable cards ---------- */
const imgOrPh = (path, cls, icon) => path ? `<img src="${esc(fileUrl(path))}" class="${cls}" alt="" loading="lazy">` : `<div class="img-placeholder ${cls}"><i class="bi ${icon}"></i></div>`;
const bookFields = b => [['Author', b.author], ['Category', b.category], ['Publisher', b.publisher], ['ISBN', b.isbn], ['Published', b.publication_year], ['Status', cap(b.status)], ['Copies', `${b.available_copies} available of ${b.quantity}`], ['Description', b.description]];
const bookCard = b => `<div class="card book-card h-100">${imgOrPh(b.cover_image, 'book-cover', 'bi-book')}<div class="card-body d-flex flex-column">
  <span class="small text-gold fw-semibold">${esc(b.category)}</span><h3 class="h6 mt-1">${esc(b.title)}</h3><p class="small text-muted mb-2">by ${esc(b.author)}</p>
  <div class="mt-auto d-flex justify-content-between align-items-center">${badge(b.status)}${detailBtn(b.title, bookFields(b), fileUrl(b.cover_image), null, 'Details')}</div></div></div>`;
const announcementCard = a => `<div class="card announce-card h-100">${a.image ? imgOrPh(a.image, 'card-img-top card-photo') : ''}<div class="card-body d-flex flex-column">
  <div class="mb-2"><span class="badge ${a.category === 'Important' ? 'bg-danger' : 'bg-maroon'}">${esc(a.category)}</span><span class="small text-muted ms-2"><i class="bi bi-calendar3"></i> ${esc(fmtDate(a.announcement_date))}</span></div>
  <h3 class="h5">${esc(a.title)}</h3><p class="text-muted">${esc(cut(a.content, 140))}</p>
  <div class="mt-auto d-flex justify-content-between align-items-center"><small class="text-muted">By ${esc(a.posted_by_name || 'Admin')}</small>
  ${detailBtn(a.title, [['Category', a.category], ['Date', fmtDate(a.announcement_date)], ['Posted by', a.posted_by_name || 'Admin'], ['Announcement', a.content]], fileUrl(a.image), null, 'Read More')}</div></div></div>`;
const planCard = (p, actions = '') => `<div class="card plan-card h-100"><div class="card-body d-flex flex-column">
  <div class="d-flex justify-content-between align-items-start mb-2"><h3 class="h5 mb-0">${esc(p.title)}</h3>${badge(p.status)}</div>
  <p class="text-muted small">${esc(cut(p.objective, 120))}</p>
  <div class="d-flex justify-content-between small fw-semibold"><span>Progress</span><span>${+p.progress}%</span></div>
  <div class="progress mb-3"><div class="progress-bar" style="width:${+p.progress}%"></div></div>
  <ul class="list-unstyled small text-muted mb-3"><li><i class="bi bi-calendar-event text-gold"></i> Target Date: ${esc(fmtDate(p.target_date))}</li><li><i class="bi bi-people text-gold"></i> ${esc(p.responsible_person || '')}</li></ul>
  <div class="mt-auto d-flex flex-wrap gap-1">${detailBtn(p.title, [['Objective', p.objective], ['Description', p.description], ['Target date', fmtDate(p.target_date)], ['Responsible', p.responsible_person], ['Status', cap(p.status)], ['Progress', p.progress + '%']])}${actions}</div></div></div>`;
const accCard = a => `<div class="card acc-card h-100">${imgOrPh(a.image, 'card-img-top card-photo', 'bi-trophy')}<div class="card-body d-flex flex-column">
  <span class="small text-gold fw-semibold"><i class="bi bi-calendar3"></i> ${esc(fmtDate(a.report_date))}</span><h3 class="h5 mt-1">${esc(a.title)}</h3>
  <p class="small text-muted mb-1">${esc(a.activity_name)}</p><p class="text-muted">${esc(cut(a.description, 110))}</p>
  <div class="mt-auto">${detailBtn(a.title, [['Activity', a.activity_name], ['Date', fmtDate(a.report_date)], ['Description', a.description], ['Accomplishments', a.accomplishments], ['Participants', a.participants], ['Results', a.results]],
    fileUrl(a.image), a.document ? ['Download attached document', fileUrl(a.document)] : null, 'View Report')}</div></div></div>`;
const albumCard = al => { const ph = (al.activity_photos || []).slice().sort((x, y) => x.id - y.id); const n = ph.length;
  return `<a href="#/album/${+al.id}" class="text-decoration-none text-dark"><div class="card h-100">${imgOrPh(ph[0]?.image, 'card-img-top card-photo', 'bi-images')}<div class="card-body">
  <h3 class="h5">${esc(al.title)}</h3><p class="small text-muted mb-2"><i class="bi bi-calendar3"></i> ${esc(fmtDate(al.activity_date))} &nbsp;&bull;&nbsp; <i class="bi bi-images"></i> ${n} photo${n === 1 ? '' : 's'}</p>
  ${al.description ? `<p class="text-muted small mb-0">${esc(cut(al.description, 100))}</p>` : ''}</div></div></a>`; };

const annQuery = () => sb.from('announcements').select('*').eq('status', 'published').order('announcement_date', { ascending: false }).order('id', { ascending: false });
const planQuery = () => sb.from('target_plans').select('*').in('status', ['planned', 'ongoing']).order('target_date');
const accQuery = () => sb.from('accomplishments').select('*').eq('status', 'published').order('report_date', { ascending: false });

/* ---------- navigation + footer ---------- */
function nav() {
  const cur = parse()[0] || '';
  const links = [['', 'Home'], ['about', 'About'], ['books', 'Books'], ['announcements', 'Announcements'], ['plans', 'Target Plans'], ['accomplishments', 'Accomplishments']];
  if (!state.profile) links.push(['join', 'Join the Club']);
  const p = state.profile;
  const right = !p ? `<li class="nav-item ms-lg-2"><a class="nav-link ${cur === 'login' ? 'active' : ''}" href="#/login">Login</a></li><li class="nav-item"><a class="btn btn-gold btn-sm" href="#/register">Sign Up</a></li>`
    : `<li class="nav-item ms-lg-2"><a class="nav-link ${cur === 'dashboard' || cur === 'admin' ? 'active' : ''}" href="#/${p.role === 'admin' ? 'admin' : 'dashboard'}">${p.role === 'admin' ? 'Admin Panel' : 'Dashboard'}</a></li>
       <li class="nav-item"><a class="nav-link ${cur === 'profile' ? 'active' : ''}" href="#/profile">Profile</a></li>
       <li class="nav-item ms-lg-2"><button class="btn btn-gold btn-sm" data-act="logout"><i class="bi bi-box-arrow-right"></i> Logout</button></li>`;
  $('#nav').innerHTML = `<nav class="navbar navbar-expand-lg sticky-top pahina-nav"><div class="container">
    <a class="navbar-brand" href="#/"><img src="logo.svg" alt=""><span>PAHINA</span></a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav"><i class="bi bi-list text-white fs-2"></i></button>
    <div class="collapse navbar-collapse" id="mainNav"><ul class="navbar-nav ms-auto align-items-lg-center">
      ${links.map(([k, l]) => `<li class="nav-item"><a class="nav-link ${cur === k ? 'active' : ''}" href="#/${k}">${esc(l)}</a></li>`).join('')}${right}</ul></div></div></nav>`;
}
function footer() {
  $('#footer').innerHTML = `<footer class="site-footer"><div class="container"><div class="row g-4">
    <div class="col-lg-5"><div class="d-flex align-items-center gap-2 mb-3"><img src="logo.svg" width="46" alt=""><span class="footer-title">${esc(C.SITE_NAME)}</span></div>
      <p class="mb-1"><i class="bi bi-building"></i> ${esc(C.SCHOOL_NAME)}</p><p class="fst-italic text-gold">"Read. Relate. Revel."</p></div>
    <div class="col-6 col-lg-3"><h6>Explore</h6><ul class="list-unstyled"><li><a href="#/about">About</a></li><li><a href="#/books">Books</a></li><li><a href="#/announcements">Announcements</a></li><li><a href="#/plans">Target Plans</a></li><li><a href="#/accomplishments">Accomplishments</a></li><li><a href="#/join">Join the Club</a></li></ul></div>
    <div class="col-6 col-lg-4"><h6>Contact</h6><p class="mb-1"><i class="bi bi-envelope"></i> ${esc(C.CONTACT_EMAIL)}</p><p><i class="bi bi-telephone"></i> ${esc(C.CONTACT_PHONE)}</p></div>
  </div><hr><p class="text-center small mb-0">&copy; ${new Date().getFullYear()} ${esc(C.SITE_NAME)}. All rights reserved.</p></div></footer>`;
}

/* ---------- router ---------- */
const parse = () => location.hash.replace(/^#\/?/, '').split('/');
async function render() {
  const [r = '', ...args] = parse();
  nav(); window.scrollTo(0, 0); view(spinner);
  try {
    if (R[r]) await R[r](args);
    else view(hero('Page not found') + wrap(empty('That page does not exist.')));
  } catch (e) { console.error(e); view(wrap(alertHtml(e.message || 'Something went wrong. Please try again.'))); }
  footer();
}

/* ---------- PUBLIC PAGES ---------- */
R[''] = async () => {
  const [st, an, pl, ac, bk] = must(...await Promise.all([sb.rpc('public_stats'), annQuery().limit(1), planQuery().limit(1), accQuery().limit(4), sb.from('books').select('*').order('id', { ascending: false }).limit(4)]));
  const s = st.data || {}, p = state.profile;
  const stats = [['bi-people', 'Total Members', s.members], ['bi-book', 'Total Books', s.books], ['bi-bullseye', 'Active Target Plans', s.plans], ['bi-trophy', 'Accomplishments', s.accomplishments]];
  const btns = p ? `<a href="#/${p.role === 'admin' ? 'admin' : 'dashboard'}" class="btn btn-gold btn-lg px-4">Go to My Dashboard</a>`
    : `<a href="#/join" class="btn btn-gold btn-lg px-4">Join the Club</a><a href="#/login" class="btn btn-outline-light btn-lg px-4">Login</a><a href="#/register" class="btn btn-outline-light btn-lg px-4">Sign Up</a>`;
  view(`<section class="hero"><i class="bi bi-book-half bg-icon"></i><div class="container text-center position-relative">
      <img src="logo.svg" class="hero-logo mb-3" alt=""><h1>PAHINA</h1><p class="h4 font-display mb-2">Book Lovers' Club</p><p class="motto">"Read. Relate. Revel."</p>
      <p class="mx-auto mb-4" style="max-width:620px;opacity:.9">A community of readers, thinkers and storytellers. Discover our library, join our activities and grow together through the love of books.</p>
      <div class="d-flex flex-wrap gap-2 justify-content-center">${btns}<a href="#/about" class="btn btn-outline-light btn-lg px-4"><i class="bi bi-info-circle"></i> About Us</a><a href="#/books" class="btn btn-outline-light btn-lg px-4"><i class="bi bi-search"></i> Explore Books</a></div></div></section>
    <section class="stats-band"><div class="container"><div class="row g-4">${stats.map(([i, l, n]) => `<div class="col-6 col-lg-3"><div class="stat-box"><i class="bi ${i}"></i><div class="num">${+n || 0}</div><div>${esc(l)}</div></div></div>`).join('')}</div></div></section>
    <section class="section section-cream"><div class="container"><div class="section-title"><span>What's happening</span><h2>Latest from the Club</h2></div><div class="row g-4">
      <div class="col-lg-4"><h3 class="h6 text-gold text-uppercase">Latest Announcement</h3>${an.data[0] ? announcementCard(an.data[0]) : empty('No announcements yet.')}</div>
      <div class="col-lg-4"><h3 class="h6 text-gold text-uppercase">Upcoming Target Plan</h3>${pl.data[0] ? planCard(pl.data[0]) : empty('No upcoming plans.')}</div>
      <div class="col-lg-4"><h3 class="h6 text-gold text-uppercase">Latest Accomplishment</h3>${ac.data[0] ? accCard(ac.data[0]) : empty('No reports yet.')}</div></div></div></section>
    <section class="section"><div class="container"><div class="section-title"><span>Our collection</span><h2>Featured Books</h2></div>${grid(bk.data.map(bookCard), 'col-6 col-lg-3')}
      <div class="text-center mt-4"><a href="#/books" class="btn btn-maroon">Browse All Books</a></div></div></section>
    ${ac.data.length > 1 ? `<section class="section section-cream"><div class="container"><div class="section-title"><span>Memories</span><h2>Recent Activities</h2></div>${grid(ac.data.slice(1).map(accCard))}
      <div class="text-center mt-4"><a href="#/accomplishments" class="btn btn-outline-maroon">View All Accomplishments</a></div></div></section>` : ''}`);
};

R.about = async () => {
  const { data, error } = await sb.from('officers').select('*').order('sort_order').order('id'); if (error) throw error;
  const groups = {}; data.forEach(o => (groups[o.position] ||= []).push(o));
  view(hero('About PAHINA', 'Who we are and the people behind the club') + `<section class="section"><div class="container"><div class="row g-4 align-items-center">
    <div class="col-lg-6"><p class="lead">PAHINA (Filipino for "page") is the official book lovers' organization of ${esc(C.SCHOOL_NAME)}. We manage a student-run library and organize reading programs, literary events and community activities.</p>
      <p class="text-muted">Our purpose is to make reading accessible, enjoyable and social. Through our library system, members can browse books, follow our target plans, read announcements and celebrate our accomplishments together.</p></div>
    <div class="col-lg-6"><div class="row g-3">
      <div class="col-sm-6"><div class="card h-100 text-center p-4"><div class="icon-circle"><i class="bi bi-flag"></i></div><h3 class="h5">Mission</h3><p class="small text-muted mb-0">To nurture a culture of reading by providing books, programs and a welcoming community for every student.</p></div></div>
      <div class="col-sm-6"><div class="card h-100 text-center p-4"><div class="icon-circle"><i class="bi bi-eye"></i></div><h3 class="h5">Vision</h3><p class="small text-muted mb-0">A school where every learner is an engaged reader, critical thinker and lifelong lover of books.</p></div></div></div></div></div>
    <div class="section-title mt-5"><span>Our team</span><h2>Executive Officers</h2></div>
    ${!data.length ? empty('Officers will be listed here soon.') : `<div class="row g-4 justify-content-center">${Object.entries(groups).map(([pos, people]) => `<div class="col-sm-6 col-lg-4"><div class="card h-100 text-center p-4">
      <h3 class="h6 text-gold text-uppercase mb-3">${esc(pos)}</h3><div class="d-flex flex-wrap justify-content-center gap-3">${people.map(p => `<div style="max-width:150px">
      ${p.photo ? `<img src="${esc(fileUrl(p.photo))}" alt="${esc(p.full_name)}" loading="lazy" class="officer-photo mb-2">` : '<div class="icon-circle mx-auto"><i class="bi bi-person-badge"></i></div>'}
      <p class="fw-semibold mb-0">${esc(p.full_name)}</p>${p.course ? `<p class="small text-muted mb-0">${esc(p.course)}</p>` : ''}</div>`).join('')}</div></div></div>`).join('')}</div>`}</div></section>`);
};

R.books = async () => {
  view(hero('Books', 'Browse our library collection') + wrap(`<form id="bookFilter" class="row g-2 mb-4"><div class="col-md-6"><input class="form-control" id="bq" placeholder="Search by title, author or ISBN..."></div>
    <div class="col-md-4"><select class="form-select" id="bcat"><option value="">All categories</option>${opts(C.BOOK_CATEGORIES)}</select></div>
    <div class="col-md-2 d-grid"><button class="btn btn-maroon"><i class="bi bi-search"></i> Search</button></div></form><div id="bookResults">${spinner}</div>`));
  const load = async () => {
    const q = $('#bq').value.trim().replace(/[,()%*\\]/g, ' '), cat = $('#bcat').value;
    let query = sb.from('books').select('*').order('title');
    if (q) query = query.or(`title.ilike.*${q}*,author.ilike.*${q}*,isbn.ilike.*${q}*`);
    if (cat) query = query.eq('category', cat);
    const { data, error } = await query;
    $('#bookResults').innerHTML = error ? alertHtml(error.message) : data.length ? grid(data.map(bookCard), 'col-6 col-md-4 col-lg-3') : empty('No books found.');
  };
  $('#bookFilter').onsubmit = e => { e.preventDefault(); load(); };
  load();
};

R.announcements = async () => { const [r] = must(await annQuery()); view(hero('Announcements', 'News and updates from the club') + wrap(r.data.length ? grid(r.data.map(announcementCard)) : empty('No announcements yet.'))); };
R.plans = async () => { const { data, error } = await sb.from('target_plans').select('*').order('target_date'); if (error) throw error;
  view(hero('Target Plans', 'Our goals and the progress we are making') + wrap(data.length ? grid(data.map(p => planCard(p))) : empty('No target plans yet.'))); };

R.accomplishments = async () => {
  const [ac, al] = must(...await Promise.all([accQuery(), sb.from('activity_albums').select('*, activity_photos(id,image)').order('activity_date', { ascending: false }).order('id', { ascending: false })]));
  view(hero('Accomplishments', 'Reports and photos of the activities we have completed') + wrap(ac.data.length ? grid(ac.data.map(accCard)) : empty('No accomplishment reports yet.'))
    + `<section class="section section-cream"><div class="container"><div class="section-title"><span>Memories</span><h2>Gallery of Activities</h2></div>${al.data.length ? grid(al.data.map(albumCard)) : empty('No albums yet.')}</div></section>`);
};

R.album = async ([id]) => {
  const { data: al, error } = await sb.from('activity_albums').select('*, activity_photos(id,image)').eq('id', +id || 0).maybeSingle(); if (error) throw error;
  if (!al) return go('#/accomplishments');
  const ph = al.activity_photos.slice().sort((a, b) => a.id - b.id);
  view(hero(al.title, `${fmtDate(al.activity_date)} • ${ph.length} photo${ph.length === 1 ? '' : 's'}`) + wrap(`<a href="#/accomplishments" class="btn btn-sm btn-outline-maroon mb-4"><i class="bi bi-arrow-left"></i> Back to Accomplishments</a>
    ${al.description ? `<p class="lead mb-4">${esc(al.description).replace(/\n/g, '<br>')}</p>` : ''}
    ${ph.length ? grid(ph.map(p => { const src = esc(fileUrl(p.image)); return `<a href="#" class="gallery-item" data-lightbox="${src}" data-title="${esc(al.title)}"><img src="${src}" alt="" loading="lazy"><span class="gallery-caption"><i class="bi bi-zoom-in"></i> View</span></a>`; }), 'col-6 col-md-4 col-lg-3') : empty('No photos in this album yet.')}`));
};

/* ---------- JOIN + STATUS ---------- */
R.join = async () => {
  if (state.profile) return go('#/' + (state.profile.role === 'admin' ? 'admin' : 'dashboard'));
  view(hero('Join the Club', 'Become a PAHINA member: read, relate and revel with us') + wrap(`<div class="card mx-auto" style="max-width:820px"><div class="card-body p-4 p-md-5" id="joinBox">
    <h2 class="h4 mb-1">Membership Application</h2><p class="text-muted mb-4">Fill in the form below. The club officers will review your application.</p><div id="joinErr"></div>
    <form id="joinForm" class="row g-3"><div class="d-none" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <div class="col-md-8"><label class="form-label">Full Name</label><input class="form-control" name="full_name" maxlength="120" required></div>
      <div class="col-md-4"><label class="form-label">Student ID</label><input class="form-control" name="student_id" maxlength="20" required></div>
      <div class="col-md-6"><label class="form-label">Email</label><input type="email" class="form-control" name="email" maxlength="150" required></div>
      <div class="col-md-6"><label class="form-label">Contact Number</label><input class="form-control" name="contact_number" maxlength="20" required></div>
      <div class="col-md-8"><label class="form-label">College / Department</label><select class="form-select" name="department" required><option value="">Choose...</option>${opts(C.DEPARTMENTS)}</select></div>
      <div class="col-md-4"><label class="form-label">Year Level</label><select class="form-select" name="year_level" required><option value="">Choose...</option>${opts(C.YEAR_LEVELS)}</select></div>
      <div class="col-12"><label class="form-label">Why do you want to join PAHINA? <span class="text-muted">(optional)</span></label><textarea class="form-control" name="reason" rows="4" maxlength="1000"></textarea></div>
      <div class="col-12"><div class="form-check"><input class="form-check-input" type="checkbox" name="confirm" id="confirm" required><label class="form-check-label" for="confirm">I confirm that the information above is correct.</label></div></div>
      <div class="col-12 d-grid"><button class="btn btn-maroon btn-lg">Send Application</button></div>
      <p class="text-center text-muted small mb-0">Already applied? <a href="#/status">Check your application status</a>. Want a library account? <a href="#/register">Sign up here</a>.</p></form></div></div>`));
  $('#joinForm').onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target)); for (const k in v) v[k] = String(v[k]).trim();
    if (v.website) return showJoinDone();
    const err = [];
    if (+sessionStorage.getItem('joinCount') >= 5) err.push('Too many applications from this browser. Please try again later.');
    if (v.full_name.length < 3 || v.full_name.length > 120) err.push('Full name must be 3-120 characters.');
    if (!/^[A-Za-z0-9-]{3,20}$/.test(v.student_id)) err.push('Student ID may only contain letters, numbers and dashes.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err.push('Enter a valid email address.');
    if (!/^[0-9+\-\s]{7,20}$/.test(v.contact_number)) err.push('Enter a valid contact number.');
    if (!C.DEPARTMENTS.includes(v.department)) err.push('Please choose your college/department.');
    if (!C.YEAR_LEVELS.includes(v.year_level)) err.push('Please choose your year level.');
    if (err.length) return $('#joinErr').innerHTML = alertHtml(err.join(' '));
    const btn = $('button.btn-maroon', e.target); btn.disabled = true;
    const { error } = await sb.from('membership_applications').insert({ full_name: v.full_name, student_id: v.student_id, email: v.email, contact_number: v.contact_number, department: v.department, year_level: v.year_level, reason: v.reason || null });
    btn.disabled = false;
    if (error) return $('#joinErr').innerHTML = alertHtml(error.code === '23505' ? 'We already received an application with that email or Student ID.' : error.message);
    sessionStorage.setItem('joinCount', (+sessionStorage.getItem('joinCount') || 0) + 1); showJoinDone();
  };
  const showJoinDone = () => $('#joinBox').innerHTML = `<div class="text-center py-4"><i class="bi bi-check-circle text-success display-4"></i><h2 class="h4 mt-3">Application sent!</h2>
    <p class="text-muted">The club officers will review it soon. Check the result anytime on the Application Status page using your email and Student ID.</p><a href="#/status" class="btn btn-maroon">Check Application Status</a></div>`;
};

R.status = async () => {
  view(hero('Application Status', 'Check the result of your membership application') + wrap(`<div class="card mx-auto" style="max-width:620px"><div class="card-body p-4 p-md-5">
    <form id="stForm" class="row g-3"><div class="col-12"><label class="form-label">Email used in your application</label><input type="email" class="form-control" name="email" required></div>
    <div class="col-12"><label class="form-label">Student ID</label><input class="form-control" name="student_id" maxlength="20" required></div><div class="col-12 d-grid"><button class="btn btn-maroon">Check Status</button></div></form><div id="stOut"></div></div></div>`));
  $('#stForm').onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const { data, error } = await sb.rpc('check_application', { p_email: v.email.trim(), p_student_id: v.student_id.trim() });
    if (error) return $('#stOut').innerHTML = alertHtml(error.message);
    const a = data[0];
    if (!a) return $('#stOut').innerHTML = `<div class="alert alert-warning mt-4 mb-0">No application found with that email and Student ID. Check for typos, or <a href="#/join">apply here</a>.</div>`;
    const cls = { pending: 'secondary', approved: 'success', rejected: 'danger' }[a.status];
    const txt = { pending: 'Your application is still being reviewed by the club officers.', approved: 'Congratulations! Your application was approved.', rejected: 'Your application was not approved this time.' }[a.status];
    $('#stOut').innerHTML = `<hr class="my-4"><p class="mb-1 text-muted small">Application for <strong>${esc(a.full_name)}</strong> &bull; sent ${esc(fmtDate(a.created_at))}</p>
      <div class="alert alert-${cls} mb-3"><strong>${esc(cap(a.status))}.</strong> ${esc(txt)}</div>
      ${a.admin_message ? `<div class="border rounded p-3 mb-3"><div class="small text-muted mb-1">Message from the club officers</div>${esc(a.admin_message).replace(/\n/g, '<br>')}</div>` : ''}
      ${a.status === 'approved' ? '<a href="#/register" class="btn btn-gold">Create your account</a>' : ''}`;
  };
};

/* ---------- AUTH ---------- */
const authCard = (title, sub, body, w = 460) => view(`<div class="container py-5"><div class="card mx-auto" style="max-width:${w}px"><div class="card-body p-4 p-md-5"><div class="text-center mb-4"><img src="logo.svg" width="70" alt="">
  <h1 class="h3 mt-2">${esc(title)}</h1><p class="text-muted">${esc(sub)}</p></div><div id="authMsg"></div>${body}</div></div></div>`);
const authMsg = (m, t = 'danger') => $('#authMsg').innerHTML = alertHtml(m, t);
const pwOk = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

R.login = async () => {
  if (state.profile) return go('#/' + (state.profile.role === 'admin' ? 'admin' : 'dashboard'));
  authCard('Welcome Back', 'Log in to your PAHINA account', `<form id="loginForm" class="row g-3"><div class="col-12"><label class="form-label">Email</label><input type="email" class="form-control" name="email" required autofocus></div>
    <div class="col-12"><label class="form-label">Password</label><input type="password" class="form-control" name="password" required></div><div class="col-12 d-grid"><button class="btn btn-maroon btn-lg">Login</button></div>
    <p class="text-center mb-0"><a href="#/forgot">Forgot password?</a> &bull; No account yet? <a href="#/register">Sign up</a></p></form>`);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); const btn = $('button', e.target); btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
    if (error) { btn.disabled = false; return authMsg(/confirm/i.test(error.message) ? 'Please confirm your email first (check your inbox).' : 'Invalid email or password.'); }
    await setSession(data.session); btn.disabled = false;
    if (!state.profile) return authMsg('Your account is deactivated or has no profile. Please contact the administrator.');
    go('#/' + (state.profile.role === 'admin' ? 'admin' : 'dashboard'));
  };
};

R.register = async () => {
  if (state.profile) return go('#/dashboard');
  authCard('Join PAHINA', 'Create your member account', `<form id="regForm" class="row g-3">
    <div class="col-md-8"><label class="form-label">Full Name</label><input class="form-control" name="full_name" maxlength="120" required></div>
    <div class="col-md-4"><label class="form-label">Student ID</label><input class="form-control" name="student_id" maxlength="20" required></div>
    <div class="col-md-6"><label class="form-label">Email</label><input type="email" class="form-control" name="email" required></div>
    <div class="col-md-6"><label class="form-label">Contact Number</label><input class="form-control" name="contact_number" maxlength="20" required></div>
    <div class="col-md-8"><label class="form-label">College / Department</label><select class="form-select" name="department" required><option value="">Choose...</option>${opts(C.DEPARTMENTS)}</select></div>
    <div class="col-md-4"><label class="form-label">Year Level</label><select class="form-select" name="year_level" required><option value="">Choose...</option>${opts(C.YEAR_LEVELS)}</select></div>
    <div class="col-12"><label class="form-label">Username</label><input class="form-control" name="username" pattern="[A-Za-z0-9_]{4,30}" title="4-30 letters, numbers or underscore" required></div>
    <div class="col-md-6"><label class="form-label">Password</label><input type="password" class="form-control" name="password" minlength="8" required><div class="form-text">At least 8 characters, with letters and numbers.</div></div>
    <div class="col-md-6"><label class="form-label">Confirm Password</label><input type="password" class="form-control" name="confirm_password" minlength="8" required></div>
    <div class="col-12 d-grid"><button class="btn btn-maroon btn-lg">Create Account</button></div><p class="text-center mb-0">Already a member? <a href="#/login">Login</a></p></form>`, 760);
  $('#regForm').onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); for (const k in v) if (!/password/.test(k)) v[k] = String(v[k]).trim();
    const err = [];
    if (v.full_name.length < 3 || v.full_name.length > 120) err.push('Full name must be 3-120 characters.');
    if (!/^[A-Za-z0-9-]{3,20}$/.test(v.student_id)) err.push('Student ID may only contain letters, numbers and dashes.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) err.push('Enter a valid email address.');
    if (!/^[0-9+\-\s]{7,20}$/.test(v.contact_number)) err.push('Enter a valid contact number.');
    if (!C.DEPARTMENTS.includes(v.department)) err.push('Please choose your college/department.');
    if (!C.YEAR_LEVELS.includes(v.year_level)) err.push('Please choose your year level.');
    if (!/^[A-Za-z0-9_]{4,30}$/.test(v.username)) err.push('Username must be 4-30 letters, numbers or underscores.');
    if (!pwOk(v.password)) err.push('Password must be 8+ characters with letters and numbers.');
    if (v.password !== v.confirm_password) err.push('Passwords do not match.');
    if (err.length) return authMsg(err.join(' '));
    const btn = $('button.btn-maroon', e.target); btn.disabled = true;
    const taken = await sb.rpc('registration_taken', { p_student_id: v.student_id, p_username: v.username });
    if (taken.data) { btn.disabled = false; return authMsg('That Student ID or username is already registered.'); }
    const { data, error } = await sb.auth.signUp({ email: v.email, password: v.password, options: { emailRedirectTo: location.origin + location.pathname,
      data: { full_name: v.full_name, student_id: v.student_id, contact_number: v.contact_number, department: v.department, year_level: v.year_level, username: v.username } } });
    btn.disabled = false;
    if (error) return authMsg(error.message);
    if (data.session) { await setSession(data.session); toast('success', 'Account created! Welcome to PAHINA.'); return go('#/dashboard'); }
    authCard('Check your email', 'One more step', `<p class="text-center">We sent a confirmation link to <strong>${esc(v.email)}</strong>. Click it, then <a href="#/login">log in</a>.</p>`);
  };
};

R.forgot = async () => {
  authCard('Forgot Password', 'We will email you a reset link', `<form id="fpForm" class="row g-3"><div class="col-12"><label class="form-label">Email</label><input type="email" class="form-control" name="email" required></div>
    <div class="col-12 d-grid"><button class="btn btn-maroon">Send reset link</button></div><p class="text-center mb-0"><a href="#/login">Back to login</a></p></form>`);
  $('#fpForm').onsubmit = async e => { e.preventDefault(); const email = new FormData(e.target).get('email').trim();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '?reset=1' });
    error ? authMsg(error.message) : authMsg('If that email has an account, a reset link is on its way.', 'success'); };
};

R.reset = async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return authCard('Reset Password', '', '<p class="text-center">This reset link is invalid or expired. <a href="#/forgot">Request a new one</a>.</p>');
  authCard('Choose a New Password', '', `<form id="rsForm" class="row g-3"><div class="col-12"><label class="form-label">New Password</label><input type="password" class="form-control" name="p1" minlength="8" required></div>
    <div class="col-12"><label class="form-label">Confirm</label><input type="password" class="form-control" name="p2" required></div><div class="col-12 d-grid"><button class="btn btn-maroon">Save password</button></div></form>`);
  $('#rsForm').onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    if (!pwOk(v.p1)) return authMsg('Password must be 8+ characters with letters and numbers.'); if (v.p1 !== v.p2) return authMsg('Passwords do not match.');
    const { error } = await sb.auth.updateUser({ password: v.p1 }); if (error) return authMsg(error.message);
    await setSession(session); toast('success', 'Password changed.'); go('#/' + (state.profile?.role === 'admin' ? 'admin' : 'dashboard')); };
};

/* ---------- MEMBER AREA ---------- */
R.dashboard = async () => {
  if (!needLogin()) return;
  if (state.profile.role === 'admin') return go('#/admin');
  const [av, an, pl, ac] = must(...await Promise.all([sb.from('books').select('id', { count: 'exact', head: true }).eq('status', 'available'), annQuery().limit(3), planQuery().limit(3), accQuery().limit(3)]));
  const sec = (t, items, none) => `<h2 class="h4 mb-3">${t}</h2><div class="mb-5">${items.length ? grid(items, 'col-md-4') : empty(none)}</div>`;
  view(wrap(`<div class="welcome-banner mb-4 d-flex flex-wrap justify-content-between align-items-center gap-3"><div><h1 class="h2 mb-1">Welcome, ${esc(state.profile.full_name)}!</h1>
    <p class="mb-0 opacity-75">Read. Relate. Revel. &mdash; here is what's new at PAHINA.</p></div><div class="text-center"><div class="font-display display-5">${av.count || 0}</div><small>Available books</small>
    <div><a href="#/books" class="btn btn-gold btn-sm mt-2">Browse Books</a></div></div></div>
    ${sec('Latest Announcements', an.data.map(announcementCard), 'No announcements yet.')}${sec('Upcoming Target Plans', pl.data.map(p => planCard(p)), 'No upcoming plans.')}${sec('Recent Accomplishments', ac.data.map(accCard), 'No reports yet.')}`));
};

R.profile = async () => {
  if (!needLogin()) return;
  const u = state.profile;
  view(hero('My Profile', 'Keep your information up to date') + wrap(`<div class="row g-4"><div class="col-lg-7"><div class="card"><div class="card-body p-4"><h2 class="h5 mb-3"><i class="bi bi-person-vcard text-gold"></i> Profile Information</h2>
    <form id="pfForm" class="row g-3"><div class="col-md-6"><label class="form-label">Student ID</label><input class="form-control" value="${esc(u.student_id)}" disabled></div>
    <div class="col-md-6"><label class="form-label">Username</label><input class="form-control" value="${esc(u.username)}" disabled></div>
    <div class="col-12"><label class="form-label">Email</label><input class="form-control" value="${esc(u.email)}" disabled></div>
    <div class="col-12"><label class="form-label">Full Name</label><input class="form-control" name="full_name" value="${esc(u.full_name)}" maxlength="120" required></div>
    <div class="col-12"><label class="form-label">Contact Number</label><input class="form-control" name="contact_number" value="${esc(u.contact_number)}" maxlength="20" required></div>
    <div class="col-md-8"><label class="form-label">College / Department</label><select class="form-select" name="department">${opts(C.DEPARTMENTS.includes(u.department) ? C.DEPARTMENTS : [u.department, ...C.DEPARTMENTS], u.department)}</select></div>
    <div class="col-md-4"><label class="form-label">Year Level</label><select class="form-select" name="year_level">${opts(C.YEAR_LEVELS, u.year_level)}</select></div>
    <div class="col-12"><button class="btn btn-maroon">Save Changes</button></div></form></div></div></div>
    <div class="col-lg-5"><div class="card"><div class="card-body p-4"><h2 class="h5 mb-3"><i class="bi bi-shield-lock text-gold"></i> Change Password</h2>
    <form id="pwForm" class="row g-3"><div class="col-12"><label class="form-label">Current Password</label><input type="password" class="form-control" name="cur" required></div>
    <div class="col-12"><label class="form-label">New Password</label><input type="password" class="form-control" name="p1" minlength="8" required></div>
    <div class="col-12"><label class="form-label">Confirm New Password</label><input type="password" class="form-control" name="p2" required></div><div class="col-12"><button class="btn btn-maroon">Update Password</button></div></form></div></div></div></div>`));
  $('#pfForm').onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); for (const k in v) v[k] = v[k].trim();
    if (v.full_name.length < 3) return toast('danger', 'Full name must be at least 3 characters.');
    if (!/^[0-9+\-\s]{7,20}$/.test(v.contact_number)) return toast('danger', 'Enter a valid contact number.');
    const { error } = await sb.from('profiles').update(v).eq('id', u.id);
    if (error) return toast('danger', error.message); Object.assign(state.profile, v); toast('success', 'Profile updated.');
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const chk = await sb.auth.signInWithPassword({ email: u.email, password: v.cur });
    if (chk.error) return toast('danger', 'Current password is incorrect.');
    if (!pwOk(v.p1)) return toast('danger', 'New password needs 8+ characters with letters and numbers.'); if (v.p1 !== v.p2) return toast('danger', 'New passwords do not match.');
    const { error } = await sb.auth.updateUser({ password: v.p1 }); if (error) return toast('danger', error.message);
    e.target.reset(); toast('success', 'Password changed.');
  };
};

/* ---------- start ---------- */
APP.start = async () => {
  if (!sb || C.SUPABASE_URL.includes('YOUR-PROJECT')) {
    return view('<div class="container py-5"><div class="alert alert-warning"><h4>Setup needed</h4>Open <code>config.js</code> and paste your Supabase Project URL and anon key. See README.md.</div></div>');
  }
  const { data: { session } } = await sb.auth.getSession();
  await setSession(session);
  if (new URLSearchParams(location.search).get('reset')) { history.replaceState(null, '', location.pathname); location.hash = '#/reset'; }
  window.addEventListener('hashchange', render);
  render();
};

Object.assign(APP, { $, esc, cap, cut, fmtDate, fileUrl, spinner, must, view, alertHtml, opts, hero, wrap, empty, grid, go, badge, toast, modal, closeModal, detailBtn, upload, removeFiles, checkFile, needAdmin, planCard, parse });
})();
