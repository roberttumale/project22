/* assets/js/admin.js - the Admin Panel (#/admin/...). Needs an admin account; Supabase RLS enforces this on the server too. */
(() => {
'use strict';
const { sb, C, state, $, esc, cap, fmtDate, fileUrl, spinner, view, alertHtml, opts, toast, modal, closeModal, detailBtn, upload, removeFiles, checkFile, badge, must } = APP;
const today = () => new Date().toISOString().slice(0, 10);
const TABS = [['dashboard', 'bi-speedometer2', 'Dashboard'], ['members', 'bi-people', 'Members'], ['applications', 'bi-person-plus', 'Applications'], ['books', 'bi-book', 'Books'],
  ['announcements', 'bi-megaphone', 'Announcements'], ['plans', 'bi-bullseye', 'Target Plans'], ['accomplishments', 'bi-trophy', 'Accomplishments'], ['officers', 'bi-person-badge', 'Officers']];
const thumb = (p, icon) => p ? `<img class="thumb" src="${esc(fileUrl(p))}" alt="">` : `<i class="bi ${icon} fs-3 text-muted"></i>`;

/* ================= generic CRUD definitions =================
 * fields: n=column, l=label, t=text|number|date|textarea|select|range, o=options, w=width(1-12), req=required, def=default
 * files : n=column, l=label, kind=image|doc, folder=storage folder
 * cols  : table columns.  extra: extra buttons.  */
const RES = {
  books: { table: 'books', single: 'Book', order: ['created_at', false],
    cols: [{ k: 'cover_image', l: 'Cover', f: r => thumb(r.cover_image, 'bi-book') }, { k: 'isbn', l: 'ISBN' }, { k: 'title', l: 'Title', b: 1 }, { k: 'author', l: 'Author' }, { k: 'category', l: 'Category' },
           { l: 'Copies', f: r => `${r.available_copies} / ${r.quantity}` }, { l: 'Status', f: r => badge(r.status) }],
    fields: [{ n: 'isbn', l: 'ISBN', w: 4 }, { n: 'title', l: 'Book Title', w: 8, req: 1 }, { n: 'author', l: 'Author', req: 1 }, { n: 'category', l: 'Category', t: 'select', o: C.BOOK_CATEGORIES },
      { n: 'publisher', l: 'Publisher' }, { n: 'publication_year', l: 'Publication Year', t: 'number', min: 1000, max: 2100 }, { n: 'quantity', l: 'Quantity', t: 'number', w: 4, min: 0, def: 1, req: 1 },
      { n: 'available_copies', l: 'Available Copies', t: 'number', w: 4, min: 0, def: 1, req: 1 }, { n: 'status', l: 'Status', t: 'select', o: C.BOOK_STATUSES, w: 4 }, { n: 'description', l: 'Description', t: 'textarea', rows: 4 }],
    files: [{ n: 'cover_image', l: 'Book Cover (JPG/PNG/WEBP, max 3 MB)', kind: 'image', folder: 'books' }],
    validate: v => v.available_copies > v.quantity ? 'Available copies must be between 0 and the total quantity.' : (v.publication_year && (v.publication_year < 1000 || v.publication_year > new Date().getFullYear() + 1) ? 'Publication year is not valid.' : null) },

  announcements: { table: 'announcements', single: 'Announcement', order: ['announcement_date', false],
    cols: [{ k: 'title', l: 'Title', b: 1 }, { k: 'category', l: 'Category' }, { l: 'Date', f: r => esc(fmtDate(r.announcement_date)) }, { l: 'Posted By', f: r => esc(r.posted_by_name || '—') }, { l: 'Status', f: r => badge(r.status) }],
    fields: [{ n: 'title', l: 'Announcement Title', w: 12, req: 1 }, { n: 'category', l: 'Category', t: 'select', o: C.ANNOUNCEMENT_CATEGORIES }, { n: 'announcement_date', l: 'Date', t: 'date', def: today, req: 1 },
      { n: 'status', l: 'Status', t: 'select', o: ['published', 'draft'] }, { n: 'content', l: 'Content', t: 'textarea', rows: 6, req: 1 }],
    files: [{ n: 'image', l: 'Featured Image (optional)', kind: 'image', folder: 'announcements' }],
    beforeSave: (v, row) => { if (!row) { v.posted_by = state.profile.id; v.posted_by_name = state.profile.full_name; } },
    extra: [{ act: 'toggle', label: r => r.status === 'published' ? 'Unpublish' : 'Publish', cls: 'btn-outline-secondary', run: r => sb.from('announcements').update({ status: r.status === 'published' ? 'draft' : 'published' }).eq('id', r.id) }] },

  plans: { table: 'target_plans', single: 'Target Plan', order: ['target_date', true],
    cols: [{ k: 'title', l: 'Title', b: 1 }, { l: 'Target Date', f: r => esc(fmtDate(r.target_date)) }, { k: 'responsible_person', l: 'Responsible' }, { l: 'Progress', f: r => r.progress + '%' }, { l: 'Status', f: r => badge(r.status) }],
    fields: [{ n: 'title', l: 'Plan Title', w: 12, req: 1 }, { n: 'objective', l: 'Objective', t: 'textarea', rows: 2, req: 1 }, { n: 'description', l: 'Description / Planned Activities', t: 'textarea', rows: 4 },
      { n: 'target_date', l: 'Target Date', t: 'date', req: 1 }, { n: 'responsible_person', l: 'Responsible Person / Team' }, { n: 'status', l: 'Status', t: 'select', o: C.PLAN_STATUSES }, { n: 'progress', l: 'Progress', t: 'range', def: 0 }] },

  accomplishments: { table: 'accomplishments', single: 'Report', order: ['report_date', false],
    cols: [{ k: 'image', l: 'Photo', f: r => thumb(r.image, 'bi-image') }, { k: 'title', l: 'Report Title', b: 1 }, { k: 'activity_name', l: 'Activity' }, { l: 'Date', f: r => esc(fmtDate(r.report_date)) },
           { l: 'Document', f: r => r.document ? `<a href="${esc(fileUrl(r.document))}" target="_blank" rel="noopener"><i class="bi bi-file-earmark-text"></i> Open</a>` : '—' }, { l: 'Status', f: r => badge(r.status) }],
    fields: [{ n: 'title', l: 'Report Title', req: 1 }, { n: 'activity_name', l: 'Activity Name', req: 1 }, { n: 'report_date', l: 'Date', t: 'date', req: 1 }, { n: 'status', l: 'Status', t: 'select', o: ['published', 'draft'] },
      { n: 'description', l: 'Description', t: 'textarea' }, { n: 'accomplishments', l: 'Accomplishments', t: 'textarea' }, { n: 'participants', l: 'Participants', w: 12, ph: 'e.g. 45 students, 3 faculty advisers' }, { n: 'results', l: 'Results', t: 'textarea' }],
    files: [{ n: 'image', l: 'Photo (JPG/PNG/WEBP)', kind: 'image', folder: 'accomplishments' }, { n: 'document', l: 'Attached PDF / Document (max 5 MB)', kind: 'doc', folder: 'accomplishments' }],
    extra_section: albumsSection },

  officers: { table: 'officers', single: 'Officer', order: ['sort_order', true],
    cols: [{ k: 'photo', l: 'Photo', f: r => thumb(r.photo, 'bi-person-circle') }, { k: 'sort_order', l: 'Order' }, { k: 'position', l: 'Position', b: 1 }, { k: 'full_name', l: 'Name' }, { l: 'Course / Department', f: r => esc(r.course || '—') }],
    fields: [{ n: 'position', l: 'Position', req: 1, list: C.OFFICER_POSITIONS }, { n: 'full_name', l: 'Full Name', req: 1 }, { n: 'course', l: 'Course / Department', ph: 'e.g. BS Information Technology', list: C.DEPARTMENTS },
      { n: 'sort_order', l: 'Display Order (1 = first)', t: 'number', min: 0, max: 999, def: 0, req: 1 }],
    files: [{ n: 'photo', l: 'Photo (JPG/PNG/WEBP, max 3 MB)', kind: 'image', folder: 'officers' }],
    note: 'Tip: give people with the same position the same order number so they stay together on the About page.' },

  members: { table: 'profiles', single: 'Member', order: ['created_at', false], noAdd: true, noDelete: true,
    cols: [{ k: 'full_name', l: 'Name', b: 1 }, { k: 'student_id', l: 'Student ID' }, { k: 'email', l: 'Email' }, { k: 'department', l: 'Department' }, { k: 'year_level', l: 'Year' }, { k: 'username', l: 'Username' },
           { l: 'Registered', f: r => esc(fmtDate(r.created_at)) }, { l: 'Role', f: r => badge(r.role) }, { l: 'Status', f: r => badge(r.status) }],
    fields: [{ n: 'full_name', l: 'Full Name', w: 8, req: 1 }, { n: 'student_id', l: 'Student ID', w: 4, req: 1 }, { n: 'contact_number', l: 'Contact Number', req: 1 },
      { n: 'department', l: 'Department', t: 'select', o: C.DEPARTMENTS, w: 8 }, { n: 'year_level', l: 'Year Level', t: 'select', o: C.YEAR_LEVELS, w: 4 },
      { n: 'username', l: 'Username', w: 4, req: 1 }, { n: 'role', l: 'Role', t: 'select', o: ['member', 'admin'], w: 4 }, { n: 'status', l: 'Account Status', t: 'select', o: ['active', 'inactive'], w: 4 }],
    detailExtra: r => [['Email', r.email]],
    validate: v => !/^[A-Za-z0-9-]{3,20}$/.test(v.student_id) ? 'Invalid Student ID.' : !/^[A-Za-z0-9_]{4,30}$/.test(v.username) ? 'Invalid username.' : !/^[0-9+\-\s]{7,20}$/.test(v.contact_number) ? 'Invalid contact number.' : null,
    beforeSave: (v, row) => { if (row && row.id === state.profile.id) { v.role = 'admin'; v.status = 'active'; } },   // protect yourself
    extra: [{ act: 'toggle', label: r => r.status === 'active' ? 'Deactivate' : 'Activate', cls: 'btn-outline-warning', show: r => r.id !== state.profile.id,
              run: r => sb.from('profiles').update({ status: r.status === 'active' ? 'inactive' : 'active' }).eq('id', r.id) }],
    note: 'Members cannot be deleted from the website (that needs Supabase Authentication -> Users). Deactivate them instead.' }
};

/* ================= admin shell ================= */
APP.routes.admin = async ([tab = 'dashboard', arg]) => {
  if (!APP.needAdmin()) return;
  view(`<div class="admin-wrap"><aside class="admin-side"><div class="px-3 pb-2 text-uppercase small opacity-75">Admin Panel</div><nav class="nav flex-column">
    ${TABS.map(([k, i, l]) => `<a class="nav-link ${tab === k || (tab === 'album' && k === 'accomplishments') ? 'active' : ''}" href="#/admin/${k}"><i class="bi ${i}"></i> ${l}</a>`).join('')}</nav></aside>
    <section class="admin-main"><div id="adminMain">${spinner}</div></section></div>`);
  if (tab === 'dashboard') return dashboard();
  if (tab === 'applications') return applications();
  if (tab === 'album') return albumPage(+arg);
  if (RES[tab]) return resourcePage(tab);
  $('#adminMain').innerHTML = alertHtml('Unknown admin page.');
};

/* ================= dashboard ================= */
async function dashboard() {
  const cnt = q => q.then(r => { if (r.error) throw r.error; return r.count || 0; });
  const head = t => sb.from(t).select('*', { count: 'exact', head: true });
  const [m, b, ab, an, pl, ac, ap, recent] = await Promise.all([cnt(head('profiles').eq('role', 'member')), cnt(head('books')), cnt(head('books').eq('status', 'available')), cnt(head('announcements')),
    cnt(head('target_plans').in('status', ['planned', 'ongoing'])), cnt(head('accomplishments')), cnt(head('membership_applications').eq('status', 'pending')),
    sb.from('profiles').select('*').eq('role', 'member').order('created_at', { ascending: false }).limit(5)]);
  must(recent);
  const cards = [['bi-people', 'Total Members', m], ['bi-person-plus', 'Pending Applications', ap], ['bi-book', 'Total Books', b], ['bi-check-circle', 'Available Books', ab], ['bi-megaphone', 'Announcements', an], ['bi-bullseye', 'Active Target Plans', pl], ['bi-trophy', 'Accomplishments', ac]];
  $('#adminMain').innerHTML = `<div class="row g-3 mb-4">${cards.map(([i, l, n]) => `<div class="col-6 col-xl-3"><div class="card stat-card"><div class="card-body d-flex justify-content-between align-items-center"><div><div class="small text-muted">${l}</div><div class="num">${n}</div></div><i class="bi ${i}"></i></div></div></div>`).join('')}</div>
    <div class="card"><div class="card-body"><h2 class="h6 mb-3">Newest Members</h2><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Name</th><th>Student ID</th><th>Department</th><th>Registered</th></tr></thead><tbody>
    ${recent.data.map(r => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.student_id)}</td><td>${esc(r.department)}</td><td>${esc(fmtDate(r.created_at))}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted">No members yet.</td></tr>'}</tbody></table></div></div></div>`;
}

/* ================= generic table + form ================= */
async function resourcePage(key) {
  const R = RES[key], main = $('#adminMain');
  const reload = () => resourcePage(key);
  const { data, error } = await sb.from(R.table).select('*').order(R.order[0], { ascending: R.order[1] }); if (error) throw error;
  const byId = Object.fromEntries(data.map(r => [r.id, r]));
  const cell = (c, r) => `<td${c.b ? ' class="fw-semibold"' : ''}>${c.f ? c.f(r) : esc(r[c.k] ?? '')}</td>`;
  main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><input id="tblFilter" class="form-control" style="max-width:280px" placeholder="Filter..." >
      ${R.noAdd ? '' : `<button class="btn btn-maroon" data-act="add"><i class="bi bi-plus-lg"></i> Add ${esc(R.single)}</button>`}</div>${R.note ? `<p class="text-muted small">${esc(R.note)}</p>` : ''}
    <div class="card"><div class="card-body"><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr>${R.cols.map(c => `<th>${c.l}</th>`).join('')}<th style="min-width:200px">Actions</th></tr></thead><tbody>
    ${data.map(r => `<tr>${R.cols.map(c => cell(c, r)).join('')}<td class="d-flex flex-wrap gap-1"><button class="btn btn-sm btn-outline-maroon" data-act="view" data-id="${esc(r.id)}">View</button>
      <button class="btn btn-sm btn-outline-primary" data-act="edit" data-id="${esc(r.id)}"><i class="bi bi-pencil"></i> Edit</button>
      ${(R.extra || []).filter(x => !x.show || x.show(r)).map(x => `<button class="btn btn-sm ${x.cls}" data-act="${x.act}" data-id="${esc(r.id)}">${esc(x.label(r))}</button>`).join('')}
      ${R.noDelete ? '' : `<button class="btn btn-sm btn-outline-danger" data-act="delete" data-id="${esc(r.id)}"><i class="bi bi-trash"></i></button>`}</td></tr>`).join('') || `<tr><td colspan="${R.cols.length + 1}" class="text-center text-muted py-4">Nothing here yet.</td></tr>`}
    </tbody></table></div></div></div><div id="resExtra" class="mt-5"></div>`;
  $('#tblFilter').oninput = e => { const q = e.target.value.toLowerCase(); main.querySelectorAll('tbody tr').forEach(tr => tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'); };
  if (R.extra_section) await R.extra_section($('#resExtra'), reload);

  main.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, row = byId[b.dataset.id];
    if (act === 'add') return formModal(R, null, reload);
    if (act === 'edit') return formModal(R, row, reload);
    if (act === 'view') {
      const img = (R.files || []).find(f => f.kind === 'image'), doc = (R.files || []).find(f => f.kind === 'doc');
      modal(row.title || row.full_name || R.single, '', 'modal-lg'); $('#appModal .modal-body').replaceChildren(...detailNodes(R, row, img, doc)); return;
    }
    if (act === 'delete') {
      if (!confirm(`Delete this ${R.single.toLowerCase()}?`)) return;
      const { error } = await sb.from(R.table).delete().eq('id', row.id); if (error) return toast('danger', error.message);
      await removeFiles((R.files || []).map(f => row[f.n])); toast('success', R.single + ' deleted.'); return reload();
    }
    const x = (R.extra || []).find(z => z.act === act);
    if (x) { const { error } = await x.run(row); error ? toast('danger', error.message) : (toast('success', 'Updated.'), reload()); }
  };
}
function detailNodes(R, row, img, doc) {   // builds the "View" popup content safely (no raw HTML)
  const box = document.createElement('div');
  if (img && row[img.n]) { const i = document.createElement('img'); i.src = fileUrl(row[img.n]); i.className = 'img-fluid rounded mb-3'; i.alt = ''; box.append(i); }
  const dl = document.createElement('dl'); dl.className = 'row mb-0';
  for (const [k, v] of [...R.fields.map(f => [f.l, row[f.n]]), ...(R.detailExtra ? R.detailExtra(row) : [])]) {
    if (v === null || v === undefined || v === '') continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.className = 'col-sm-4'; dd.className = 'col-sm-8'; dt.textContent = k; dd.textContent = String(v); dd.style.whiteSpace = 'pre-wrap'; dl.append(dt, dd);
  }
  box.append(dl);
  if (doc && row[doc.n]) { const a = document.createElement('a'); a.href = fileUrl(row[doc.n]); a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn btn-maroon mt-3'; a.textContent = 'Download attached document'; box.append(a); }
  return [box];
}

function fieldHtml(f, row) {
  let val = row ? row[f.n] : (typeof f.def === 'function' ? f.def() : f.def);
  val = val ?? '';
  const col = 'col-md-' + (f.w || (f.t === 'textarea' ? 12 : 6)), id = 'f_' + f.n, lab = `<label class="form-label" for="${id}">${esc(f.l)}${f.t === 'range' ? `: <strong><span class="rv">${esc(val || 0)}</span>%</strong>` : ''}</label>`;
  let inp;
  if (f.t === 'select') { const list = f.o.includes(val) || val === '' ? f.o : [val, ...f.o], sel = val || f.o[0], raw = f.n === 'department' || f.n === 'year_level';
    inp = `<select class="form-select" id="${id}" name="${f.n}">${list.map(x => `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(raw ? x : cap(x))}</option>`).join('')}</select>`; }
  else if (f.t === 'textarea') inp = `<textarea class="form-control" id="${id}" name="${f.n}" rows="${f.rows || 3}">${esc(val)}</textarea>`;
  else if (f.t === 'range') inp = `<input class="form-range" type="range" min="0" max="100" step="5" id="${id}" name="${f.n}" value="${esc(val || 0)}" oninput="this.previousElementSibling.querySelector('.rv').textContent=this.value">`;
  else inp = `<input class="form-control" type="${f.t || 'text'}" id="${id}" name="${f.n}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.list ? `list="dl_${f.n}"` : ''}>`
    + (f.list ? `<datalist id="dl_${f.n}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : '');
  return `<div class="${col}">${lab}${inp}</div>`;
}

function formModal(R, row, done) {
  modal((row ? 'Edit ' : 'Add ') + R.single, `<form id="rform" class="row g-3">${R.fields.map(f => fieldHtml(f, row)).join('')}
    ${(R.files || []).map(F => `<div class="col-12"><label class="form-label">${esc(F.l)}</label><input class="form-control" type="file" name="${F.n}" accept="${F.kind === 'image' ? 'image/*' : '.pdf,.doc,.docx'}">
      ${row && row[F.n] ? '<div class="form-text">Leave empty to keep the current file.</div>' : ''}</div>`).join('')}
    <div class="col-12 text-end"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button> <button class="btn btn-maroon" id="rsave"><i class="bi bi-check-lg"></i> Save</button></div></form>`, 'modal-lg');
  $('#rform').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target), v = {};
    for (const f of R.fields) { let x = String(fd.get(f.n) ?? '').trim(); if (f.t === 'number' || f.t === 'range') x = x === '' ? null : Number(x); else if (x === '' && !f.req) x = null; v[f.n] = x; }
    const msg = R.validate ? R.validate(v, row) : null; if (msg) return toast('danger', msg);
    const btn = $('#rsave'); btn.disabled = true; const uploaded = [], old = [];
    try {
      for (const F of R.files || []) { const file = fd.get(F.n); if (file && file.size) { checkFile(file, F.kind); const p = await upload(file, F.folder); uploaded.push(p); v[F.n] = p; if (row && row[F.n]) old.push(row[F.n]); } }
      if (R.beforeSave) R.beforeSave(v, row);
      const { error } = row ? await sb.from(R.table).update(v).eq('id', row.id) : await sb.from(R.table).insert(v);
      if (error) throw error;
      await removeFiles(old); closeModal(); toast('success', R.single + ' saved.'); done();
    } catch (e) { await removeFiles(uploaded); toast('danger', e.code === '23505' ? 'That value already exists (duplicate).' : (e.message || 'Save failed.')); btn.disabled = false; }
  };
}

/* ================= applications (approve / reject with a message the applicant sees) ================= */
async function applications() {
  const main = $('#adminMain'); let filter = '';
  const { data, error } = await sb.from('membership_applications').select('*').order('created_at', { ascending: false }); if (error) throw error;
  const byId = Object.fromEntries(data.map(r => [r.id, r]));
  const pending = data.filter(a => a.status === 'pending').length;
  const draw = () => {
    const rows = data.filter(a => !filter || a.status === filter).sort((a, b) => (b.status === 'pending') - (a.status === 'pending'));
    $('#appRows').innerHTML = rows.map(a => `<tr><td class="fw-semibold">${esc(a.full_name)}</td><td>${esc(a.student_id)}</td><td>${esc(a.email)}</td><td>${esc(a.contact_number)}</td><td>${esc(a.department)}</td><td>${esc(a.year_level)}</td>
      <td>${esc(fmtDate(a.created_at))}</td><td>${badge(a.status)}</td><td class="d-flex flex-wrap gap-1">
      ${detailBtn(a.full_name, [['Student ID', a.student_id], ['Email', a.email], ['Contact', a.contact_number], ['Department', a.department], ['Year level', a.year_level], ['Applied on', fmtDate(a.created_at)], ['Status', cap(a.status)], ['Why join?', a.reason || '—'], ['Message to applicant', a.admin_message || '—']])}
      ${a.status !== 'approved' ? `<button class="btn btn-sm btn-outline-success" data-act="approve" data-id="${a.id}"><i class="bi bi-check-lg"></i> Approve</button>` : ''}
      ${a.status !== 'rejected' ? `<button class="btn btn-sm btn-outline-warning" data-act="reject" data-id="${a.id}"><i class="bi bi-x-lg"></i> Reject</button>` : ''}
      ${a.status !== 'pending' ? `<button class="btn btn-sm btn-outline-secondary" data-act="reopen" data-id="${a.id}">Reopen</button>` : ''}
      <button class="btn btn-sm btn-outline-danger" data-act="delete" data-id="${a.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('') || '<tr><td colspan="9" class="text-center text-muted py-4">No applications found.</td></tr>';
  };
  main.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><p class="mb-0 text-muted">Applications from the public <a href="#/join" target="_blank">Join the Club</a> page. <strong>${pending}</strong> pending. The applicant sees your message on the <a href="#/status" target="_blank">Application Status</a> page.</p>
    <select class="form-select" id="stFilter" style="max-width:200px"><option value="">All applications</option>${['pending', 'approved', 'rejected'].map(s => `<option value="${s}">${cap(s)}</option>`).join('')}</select></div>
    <div class="card"><div class="card-body"><div class="table-responsive"><table class="table table-hover align-middle"><thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Contact</th><th>Department</th><th>Year</th><th>Applied</th><th>Status</th><th style="min-width:280px">Actions</th></tr></thead><tbody id="appRows"></tbody></table></div></div></div>`;
  draw(); $('#stFilter').onchange = e => { filter = e.target.value; draw(); };
  main.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = byId[b.dataset.id], act = b.dataset.act;
    if (act === 'approve' || act === 'reject') {
      const st = act === 'approve' ? 'approved' : 'rejected';
      modal((act === 'approve' ? 'Approve: ' : 'Reject: ') + a.full_name, `<form id="rvForm"><label class="form-label">Message to the applicant <span class="text-muted">(shown on the Application Status page)</span></label>
        <textarea class="form-control" name="message" rows="5" maxlength="1000">${act === 'approve' ? 'Congratulations! Your application to join PAHINA has been approved. Welcome to the club!' : 'Thank you for your interest in PAHINA. Unfortunately, we are unable to approve your application at this time. You are welcome to apply again in the future.'}</textarea>
        <div class="text-end mt-3"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button> <button class="btn btn-maroon">${act === 'approve' ? 'Approve' : 'Reject'}</button></div></form>`);
      $('#rvForm').onsubmit = async ev => { ev.preventDefault(); const msg = new FormData(ev.target).get('message').trim();
        const { error } = await sb.from('membership_applications').update({ status: st, admin_message: msg || null, reviewed_at: new Date().toISOString() }).eq('id', a.id);
        if (error) return toast('danger', error.message); closeModal(); toast('success', 'Application marked as ' + st + '.'); applications(); };
    } else if (act === 'reopen') {
      const { error } = await sb.from('membership_applications').update({ status: 'pending', admin_message: null, reviewed_at: null }).eq('id', a.id); error ? toast('danger', error.message) : (toast('success', 'Application reopened.'), applications());
    } else if (act === 'delete') {
      if (!confirm('Delete this application?')) return;
      const { error } = await sb.from('membership_applications').delete().eq('id', a.id); error ? toast('danger', error.message) : (toast('success', 'Application deleted.'), applications());
    }
  };
}

/* ================= albums (Gallery of Activities) ================= */
async function albumsSection(el, reload) {
  const { data, error } = await sb.from('activity_albums').select('*, activity_photos(id,image)').order('activity_date', { ascending: false }).order('id', { ascending: false }); if (error) throw error;
  const byId = Object.fromEntries(data.map(a => [a.id, a]));
  el.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><h2 class="h5 mb-0"><i class="bi bi-images text-gold"></i> Gallery of Activities (Albums)</h2><button class="btn btn-maroon" data-act="alb-add"><i class="bi bi-plus-lg"></i> Create Album</button></div>
    <div class="row g-4">${data.map(al => { const ph = al.activity_photos.slice().sort((a, b) => a.id - b.id); return `<div class="col-sm-6 col-lg-4 col-xxl-3"><div class="card h-100">
      ${ph[0] ? `<img src="${esc(fileUrl(ph[0].image))}" class="card-img-top card-photo" alt="">` : '<div class="img-placeholder card-img-top card-photo"><i class="bi bi-images"></i></div>'}
      <div class="card-body d-flex flex-column"><h3 class="h6">${esc(al.title)}</h3><p class="small text-muted mb-3"><i class="bi bi-calendar3"></i> ${esc(fmtDate(al.activity_date))} &bull; ${ph.length} photo${ph.length === 1 ? '' : 's'}</p>
      <div class="mt-auto d-flex flex-wrap gap-1"><a class="btn btn-sm btn-outline-secondary" href="#/admin/album/${al.id}"><i class="bi bi-images"></i> Photos</a>
      <button class="btn btn-sm btn-outline-primary" data-act="alb-edit" data-id="${al.id}"><i class="bi bi-pencil"></i> Edit</button><button class="btn btn-sm btn-outline-danger" data-act="alb-del" data-id="${al.id}"><i class="bi bi-trash"></i></button></div></div></div></div>`; }).join('')
      || '<div class="empty-state"><i class="bi bi-journal-x"></i><p>No albums yet. Click "Create Album".</p></div>'}</div>`;
  el.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, al = byId[b.dataset.id];
    if (act === 'alb-add' || act === 'alb-edit') return albumForm(act === 'alb-edit' ? al : null, reload);
    if (act === 'alb-del') {
      if (!confirm('Delete this album and ALL its images?')) return;
      const paths = al.activity_photos.map(p => p.image);
      const { error } = await sb.from('activity_albums').delete().eq('id', al.id); if (error) return toast('danger', error.message);
      await removeFiles(paths); toast('success', 'Album and all its images deleted.'); reload();
    }
  };
}
async function addPhotos(albumId, files) {
  const paths = [];
  try { for (const f of files) { checkFile(f, 'image'); paths.push(await upload(f, 'gallery')); }
    if (paths.length) { const { error } = await sb.from('activity_photos').insert(paths.map(image => ({ album_id: albumId, image }))); if (error) throw error; }
    return paths.length;
  } catch (e) { await removeFiles(paths); throw e; }
}
function albumForm(al, done) {
  modal(al ? 'Edit Album' : 'Create Album', `<form id="alForm" class="row g-3"><div class="col-md-8"><label class="form-label">Album Title (activity name)</label><input class="form-control" name="title" maxlength="150" value="${esc(al?.title || '')}" required></div>
    <div class="col-md-4"><label class="form-label">Date</label><input type="date" class="form-control" name="activity_date" value="${esc(al?.activity_date || today())}" required></div>
    <div class="col-12"><label class="form-label">Description (optional)</label><textarea class="form-control" name="description" rows="3">${esc(al?.description || '')}</textarea></div>
    <div class="col-12"><label class="form-label">Images (select as many as you want)</label><input class="form-control" type="file" name="images" accept="image/*" multiple ${al ? '' : 'required'}><div class="form-text">JPG, PNG, WEBP or GIF, max 3 MB each. When editing, new images are added to the album.</div></div>
    <div class="col-12 text-end"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button> <button class="btn btn-maroon" id="alSave">Save</button></div></form>`, 'modal-lg');
  $('#alForm').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target), files = fd.getAll('images').filter(f => f.size);
    const v = { title: fd.get('title').trim(), activity_date: fd.get('activity_date'), description: fd.get('description').trim() || null };
    if (v.title.length < 2) return toast('danger', 'Album title must be 2-150 characters.'); if (!al && !files.length) return toast('danger', 'Please choose at least one image for the new album.');
    $('#alSave').disabled = true;
    try {
      let id = al?.id;
      if (al) { const { error } = await sb.from('activity_albums').update(v).eq('id', id); if (error) throw error; }
      else { const { data, error } = await sb.from('activity_albums').insert(v).select('id').single(); if (error) throw error; id = data.id; }
      const n = await addPhotos(id, files); closeModal(); toast('success', 'Album saved' + (n ? ` with ${n} new image${n > 1 ? 's' : ''}` : '') + '.'); done();
    } catch (err) { toast('danger', err.message || 'Save failed.'); $('#alSave').disabled = false; }
  };
}
async function albumPage(id) {
  const main = $('#adminMain');
  const { data: al, error } = await sb.from('activity_albums').select('*, activity_photos(id,image)').eq('id', id || 0).maybeSingle(); if (error) throw error;
  if (!al) { toast('danger', 'Album not found.'); return APP.go('#/admin/accomplishments'); }
  const ph = al.activity_photos.slice().sort((a, b) => b.id - a.id), byId = Object.fromEntries(ph.map(p => [p.id, p]));
  main.innerHTML = `<div class="mb-3"><a href="#/admin/accomplishments" class="btn btn-sm btn-light"><i class="bi bi-arrow-left"></i> Back to accomplishments</a> <span class="fw-semibold ms-2">${esc(al.title)}</span>
      <span class="text-muted small">— ${esc(fmtDate(al.activity_date))} • ${ph.length} image${ph.length === 1 ? '' : 's'}</span></div>
    <div class="card mb-4"><div class="card-body"><form id="upForm" class="row g-2 align-items-end"><div class="col-md-9"><label class="form-label">Add more images (select many at once)</label><input class="form-control" type="file" name="images" accept="image/*" multiple required>
      <div class="form-text">JPG, PNG, WEBP or GIF, max 3 MB each.</div></div><div class="col-md-3 d-grid"><button class="btn btn-maroon"><i class="bi bi-upload"></i> Upload</button></div></form></div></div>
    <div class="row g-3">${ph.map(p => `<div class="col-6 col-md-4 col-xl-3 col-xxl-2"><div class="card h-100"><a href="#" data-lightbox="${esc(fileUrl(p.image))}" data-title="${esc(al.title)}"><img src="${esc(fileUrl(p.image))}" class="card-img-top card-photo" alt="" loading="lazy"></a>
      <div class="card-body p-2 text-center"><button class="btn btn-sm btn-outline-danger" data-id="${p.id}"><i class="bi bi-trash"></i></button></div></div></div>`).join('') || '<div class="empty-state"><i class="bi bi-journal-x"></i><p>No images yet. Use the form above to add some.</p></div>'}</div>`;
  $('#upForm').onsubmit = async e => { e.preventDefault(); const btn = $('button', e.target); btn.disabled = true;
    try { const n = await addPhotos(al.id, new FormData(e.target).getAll('images').filter(f => f.size)); toast('success', `${n} image${n > 1 ? 's' : ''} added.`); albumPage(id); } catch (err) { toast('danger', err.message); btn.disabled = false; } };
  main.onclick = async e => { const b = e.target.closest('button[data-id]'); if (!b || !confirm('Delete this image?')) return; const p = byId[b.dataset.id];
    const { error } = await sb.from('activity_photos').delete().eq('id', p.id); if (error) return toast('danger', error.message); await removeFiles([p.image]); toast('success', 'Image deleted.'); albumPage(id); };
}
})();
