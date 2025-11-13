const STORAGE_KEY = 'crewtech-data-v1';

// TODO: paste your real Apps Script Web App URL between the quotes
const WORKERS_CLOUD_URL = 'https://script.google.com/macros/s/AKfycbxyB2uZ7LP-7gDGxFNTf8gXHoJARKHzFbMg_v9c4HPYDRVd0L4qwJQ_tytakxvKg3-q/exec';

/* ========== Storage Helpers ========== */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workers: [], jobs: [] };
    const parsed = JSON.parse(raw);
    return { workers: parsed.workers || [], jobs: parsed.jobs || [] };
  } catch (e) {
    console.error('Failed to parse storage, resetting.', e);
    return { workers: [], jobs: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function sortJobsByDateTime(jobs) {
  return [...jobs].sort((a, b) => {
    const da = new Date((a.date || '') + ' ' + (a.startTime || '00:00'));
    const db = new Date((b.date || '') + ' ' + (b.startTime || '00:00'));
    return da - db;
  });
}

/* ========== Formatters ========== */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getMonthKey(dateStr) {
  if (!dateStr) return 'no-date';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return 'no-date';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

function getMonthLabel(key) {
  if (key === 'no-date') return 'No Date';
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m || 0), 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function getBaseWorkerUrl() {
  const url = new URL(window.location.href);
  // strip index.html if present
  url.pathname = url.pathname.replace(/index\.html$/, '');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  // ✅ point worker links to the new Worker Portal page
  url.pathname += 'worker.html';
  url.search = '';
  url.hash = '';
  return url.toString();
}


/* ========== Assignments Helpers ========== */
function getAssignments(job) {
  if (!job.assignments || !Array.isArray(job.assignments)) {
    const baseIds = job.assignedWorkerIds || [];
    job.assignments = baseIds.map((id) => ({ workerId: id, status: '' }));
  }
  job.assignedWorkerIds = job.assignments.map((a) => a.workerId);
  return job.assignments;
}

function shortStatus(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  if (c === 'confirmed') return 'C';
  if (c === 'invited') return 'I';
  if (c === 'declined') return 'D';
  return '';
}

function getJobPhase(job) {
  if (!job || !job.phase) return '';
  const p = String(job.phase).toLowerCase();
  if (p === 'build') return 'Build';
  if (p === 'assist') return 'Assist';
  if (p === 'dismantle') return 'Dismantle';
  return '';
}

/* ========== Parser for Auto-Fill Job ========== */
function normalizeTimeToInput(str) {
  if (!str) return '';
  const s = str.trim().toLowerCase();
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return '';
  let hour = parseInt(m[1], 10);
  let minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];

  if (ampm === 'pm' && hour !== 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function parseJobText(raw) {
  if (!raw) return null;

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const line = lines[0];

  const segments = line.split(/[-–]/).map((s) => s.trim()).filter(Boolean);

  const result = { name: '', date: '', startTime: '', endTime: '', booth: '', location: '', phase: '' };

  // 1) Job name
  if (segments[0]) result.name = segments[0];

  // 2) Date: 11/12 or 11-12 or 11/12/2025
  const dateSeg = segments.find((s) => /\d{1,2}[\/\-]\d{1,2}/.test(s));
  if (dateSeg) {
    const m = dateSeg.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (m) {
      const month = parseInt(m[1], 10);
      const day = parseInt(m[2], 10);
      let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
      if (year < 100) year += 2000;
      result.date = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }

  // 3) Time range
  function isTimeLike(str) { return /(\d{1,2})(?::\d{2})?\s*(am|pm)?/i.test(str || ''); }

  let timeIndex = segments.findIndex((s) => isTimeLike(s));
  if (timeIndex !== -1) {
    let startStr = segments[timeIndex];
    let endStr = '';
    if (/[to–-]/i.test(startStr)) {
      const parts = startStr.split(/to|–|-/i).map((s) => s.trim()).filter(Boolean);
      startStr = parts[0] || '';
      endStr = parts[1] || '';
    } else {
      const next = segments[timeIndex + 1];
      if (next && isTimeLike(next)) endStr = next;
    }
    if (startStr) result.startTime = normalizeTimeToInput(startStr);
    if (endStr) result.endTime = normalizeTimeToInput(endStr);
  }

  // 4) Booth
  const boothSeg = segments.find((s) => /booth/i.test(s));
  if (boothSeg) {
    const m = boothSeg.match(/booth\s*([a-z0-9\-]+)/i);
    result.booth = m ? m[1] : boothSeg;
  }

  // 5) Location: last segment if several
  if (segments.length >= 3) result.location = segments[segments.length - 1];

  // 6) Phase guess
  const lowerAll = raw.toLowerCase();
  if (lowerAll.includes('dismantle') || lowerAll.includes('tear down') || lowerAll.includes('teardown') || lowerAll.includes('strike')) {
    result.phase = 'Dismantle';
  } else if (lowerAll.includes('assist') || lowerAll.includes('support') || lowerAll.includes('standby')) {
    result.phase = 'Assist';
  } else if (lowerAll.includes('build') || lowerAll.includes('install') || lowerAll.includes('setup')) {
    result.phase = 'Build';
  }

  return result;
}

/* ========== Renderers ========== */
function renderAssignWorkers(data) {
  const container = document.getElementById('assign-workers');
  container.innerHTML = '';
  if (!data.workers.length) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = 'No workers yet. Add them below first.';
    container.appendChild(span);
    return;
  }
  data.workers.forEach((w) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = w.id;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + w.name));
    container.appendChild(label);
  });
}

function renderWorkersTable(data) {
  const table = document.getElementById('workers-table');
  if (!table) return;
  table.innerHTML = '';

  if (!data.workers.length) {
    table.innerHTML = '<tr><td class="muted">No workers yet.</td></tr>';
    return;
  }

  const header = document.createElement('tr');
  header.innerHTML = '<th>Name</th><th>Phone</th><th>Personal link</th><th></th>';
  table.appendChild(header);

  const base = getBaseWorkerUrl();

  data.workers.forEach((w) => {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = w.name;
    tr.appendChild(nameTd);

    const phoneTd = document.createElement('td');
    phoneTd.textContent = w.phone || '';
    tr.appendChild(phoneTd);

    const linkTd = document.createElement('td');
    const linkUrl = base + '?workerId=' + encodeURIComponent(w.id);
    const input = document.createElement('input');
    input.value = linkUrl;
    input.readOnly = true;
    input.className = 'worker-link-input';
    input.addEventListener('focus', () => input.select());
    linkTd.appendChild(input);
    tr.appendChild(linkTd);

    const actionsTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'worker-delete-btn';
    delBtn.textContent = '🗑';
    delBtn.title = 'Remove worker';

    delBtn.addEventListener('click', () => {
      if (!confirm(`Remove ${w.name} from your crew and all jobs?`)) return;
      data.workers = data.workers.filter((ww) => ww.id !== w.id);
      data.jobs.forEach((job) => {
        const assignments = getAssignments(job).filter((a) => a.workerId !== w.id);
        job.assignments = assignments;
        job.assignedWorkerIds = assignments.map((a) => a.workerId);
      });
      saveData(data);
      if (window._crewtechRerenderAll) window._crewtechRerenderAll();
      else { renderAssignWorkers(data); renderWorkersTable(data); renderJobsTable(data); renderOverview(data); }
    });

    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    table.appendChild(tr);
  });
}

function renderOverview(data) {
  const nextContainer = document.getElementById('next-jobs');
  if (!nextContainer) return;
  nextContainer.innerHTML = '';

  const today = new Date(); today.setHours(0,0,0,0);

  const upcoming = sortJobsByDateTime(data.jobs).filter((job) => {
    if (!job.date) return false;
    const d = new Date(job.date + 'T00:00:00');
    return !isNaN(d) && d >= today;
  });

  const showJobs = (target, jobs) => {
    if (!jobs.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No upcoming jobs yet.';
      target.appendChild(p);
      return;
    }

    jobs.forEach((job) => {
      const card = document.createElement('div');
      card.className = 'job-card';

      const title = document.createElement('div');
      title.className = 'job-card-title';
      title.textContent = job.name || '(no name)';
      card.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'job-card-meta';
      const bits = [];
      if (job.date) bits.push(formatDate(job.date));
      if (job.startTime || job.endTime) {
        bits.push([job.startTime, job.endTime].filter(Boolean).map(formatTime).join(' – '));
      }
      if (job.booth) bits.push('Booth ' + job.booth);
      if (job.location) bits.push(job.location);
      meta.textContent = bits.join(' • ');
      card.appendChild(meta);

      const assignments = getAssignments(job);
      const ids = assignments.map((a) => a.workerId);
      if (ids.length) {
        const workersDiv = document.createElement('div');
        workersDiv.className = 'job-card-workers';
        const names = assignments
          .map((a) => {
            const w = data.workers.find((w) => w.id === a.workerId);
            if (!w) return null;
            const abbrev = shortStatus(a.status);
            return abbrev ? `${w.name} (${abbrev})` : w.name;
          })
          .filter(Boolean);
        workersDiv.textContent = 'Workers: ' + names.join(', ');
        card.appendChild(workersDiv);
      }

      target.appendChild(card);
    });
  };

  showJobs(nextContainer, upcoming.slice(0, 3));
}

function buildWorkerSummary(job, data) {
  const assignments = getAssignments(job);
  if (!assignments.length) return '0 workers';
  let confirmed = 0, invited = 0, declined = 0, other = 0;
  assignments.forEach((a) => {
    const s = (a.status || '').toLowerCase();
    if (s === 'confirmed') confirmed++;
    else if (s === 'invited') invited++;
    else if (s === 'declined') declined++;
    else other++;
  });
  const parts = [];
  if (confirmed) parts.push(`${confirmed} C`);
  if (invited) parts.push(`${invited} I`);
  if (declined) parts.push(`${declined} D`);
  if (other) parts.push(`${other} ?`);
  return `${assignments.length} worker${assignments.length > 1 ? 's' : ''}` + (parts.length ? ` (${parts.join(', ')})` : '');
}

function renderJobsTable(data) {
  const container = document.getElementById('jobs-table');
  container.innerHTML = '';

  if (!data.jobs.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No jobs yet.';
    container.appendChild(p);
    return;
  }

  const jobsSorted = sortJobsByDateTime(data.jobs);
  const groups = {};
  jobsSorted.forEach((job) => {
    const key = getMonthKey(job.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(job);
  });
  const keys = Object.keys(groups).sort();

  const today = new Date();
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  keys.forEach((key) => {
    const monthGroup = document.createElement('div');
    monthGroup.className = 'month-group';

    const header = document.createElement('div');
    header.className = 'month-header';

    const title = document.createElement('div');
    title.className = 'month-title';
    title.textContent = getMonthLabel(key);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '0.4rem';

    const count = document.createElement('div');
    count.className = 'month-count';
    count.textContent = groups[key].length + ' job' + (groups[key].length > 1 ? 's' : '');

    const arrow = document.createElement('div');
    arrow.className = 'month-arrow';
    arrow.textContent = key === currentKey ? '▾' : '▸';

    right.appendChild(count);
    right.appendChild(arrow);

    header.appendChild(title);
    header.appendChild(right);

    const body = document.createElement('div');
    body.className = 'month-body';
    body.style.display = key === currentKey ? 'block' : 'none';

    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▸' : '▾';
    });

    groups[key].forEach((job) => {
      const row = document.createElement('div');
      row.className = 'job-row';

      const headerRow = document.createElement('div');
      headerRow.className = 'job-row-header';

      const main = document.createElement('div');
      main.className = 'job-row-main';

      const titleLine = document.createElement('div');
      titleLine.className = 'job-row-title-line';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'job-row-date';
      dateSpan.textContent = job.date ? formatDateShort(job.date) : 'No date';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'job-row-name';
      nameSpan.textContent = job.name || '(no job name)';

      titleLine.appendChild(dateSpan);
      titleLine.appendChild(nameSpan);

      const phaseLabel = getJobPhase(job);
      if (phaseLabel) {
        const phaseSpan = document.createElement('span');
        const phaseClass = phaseLabel.toLowerCase();
        phaseSpan.className = 'phase-tag phase-' + phaseClass;
        phaseSpan.textContent = phaseLabel;
        titleLine.appendChild(phaseSpan);
      }

      main.appendChild(titleLine);

      const metaLine = document.createElement('div');
      metaLine.className = 'job-row-meta';

      const timeText = [job.startTime, job.endTime].filter(Boolean).map(formatTime).join(' – ');
      if (timeText) {
        const timeSpan = document.createElement('span');
        timeSpan.textContent = timeText;
        metaLine.appendChild(timeSpan);
      }

      if (job.booth || job.location) {
        const locSpan = document.createElement('span');
        const bits = [];
        if (job.booth) bits.push('Booth ' + job.booth);
        if (job.location) bits.push(job.location);
        locSpan.textContent = bits.join(' • ');
        metaLine.appendChild(locSpan);
      }

      const workersSummary = document.createElement('span');
      workersSummary.className = 'job-row-workers-summary';
      workersSummary.textContent = buildWorkerSummary(job, data);
      metaLine.appendChild(workersSummary);

      main.appendChild(metaLine);

      const arrowRow = document.createElement('div');
      arrowRow.className = 'job-row-arrow';
      arrowRow.textContent = '▸';

      headerRow.appendChild(main);
      headerRow.appendChild(arrowRow);

      const details = document.createElement('div');
      details.className = 'job-row-details';
      details.style.display = 'none';

      const grid = document.createElement('div');
      grid.className = 'job-details-grid';

      const dateBlock = document.createElement('div');
      dateBlock.innerHTML = '<div class="job-details-label">Date</div>' + `<div class="job-details-value">${job.date ? formatDate(job.date) : '-'}</div>`;
      grid.appendChild(dateBlock);

      const timeBlock = document.createElement('div');
      const timeFull = timeText || '-';
      timeBlock.innerHTML = '<div class="job-details-label">Time</div>' + `<div class="job-details-value">${timeFull}</div>`;
      grid.appendChild(timeBlock);

      const boothBlock = document.createElement('div');
      boothBlock.innerHTML = '<div class="job-details-label">Booth</div>' + `<div class="job-details-value">${job.booth || '-'}</div>`;
      grid.appendChild(boothBlock);

      const locBlock = document.createElement('div');
      locBlock.innerHTML = '<div class="job-details-label">Location</div>' + `<div class="job-details-value">${job.location || '-'}</div>`;
      grid.appendChild(locBlock);

      details.appendChild(grid);

      if (job.notes) {
        const notesBlock = document.createElement('div');
        notesBlock.className = 'job-notes-block';
        notesBlock.innerHTML = '<div class="job-details-label">Notes</div>' + `<div class="job-details-value">${job.notes}</div>`;
        details.appendChild(notesBlock);
      }

      if (job.rawText) {
        const rawBlock = document.createElement('div');
        rawBlock.className = 'job-notes-block';
        rawBlock.innerHTML = '<div class="job-details-label">Raw text</div>' + `<div class="job-details-value">${job.rawText}</div>`;
        details.appendChild(rawBlock);
      }

      const workersBlock = document.createElement('div');
      workersBlock.className = 'job-workers-block';

      const workersLabel = document.createElement('div');
      workersLabel.className = 'job-details-label';
      workersLabel.textContent = 'Workers & Status';
      workersBlock.appendChild(workersLabel);

      const assignments = getAssignments(job);
      if (!assignments.length) {
        const noWorkers = document.createElement('div');
        noWorkers.className = 'job-details-value';
        noWorkers.textContent = 'No workers assigned yet.';
        workersBlock.appendChild(noWorkers);
      } else {
        assignments.forEach((assignment) => {
          const w = data.workers.find((ww) => ww.id === assignment.workerId);
          if (!w) return;

          const rowW = document.createElement('div');
          rowW.className = 'worker-status-row';

          const nameSpanW = document.createElement('div');
          nameSpanW.className = 'worker-status-name';
          nameSpanW.textContent = w.name;
          rowW.appendChild(nameSpanW);

          const pills = document.createElement('div');
          pills.className = 'status-pills';

          const current = assignment.status || 'Invited';

          [
            { value: 'Invited', label: 'Invited', cls: 'invited' },
            { value: 'Confirmed', label: 'Confirmed', cls: 'confirmed' },
            { value: 'Declined', label: 'Declined', cls: 'declined' }
          ].forEach((opt) => {
            const pill = document.createElement('span');
            pill.className = 'status-pill ' + opt.cls;
            if (current === opt.value) pill.classList.add('active');
            pill.textContent = opt.label;

            pill.addEventListener('click', () => {
              assignment.status = opt.value;
              job.assignedWorkerIds = job.assignments.map((a) => a.workerId);
              saveData(data);
              rerenderAll();
            });

            pills.appendChild(pill);
          });

          rowW.appendChild(pills);
          workersBlock.appendChild(rowW);
        });
      }

      details.appendChild(workersBlock);

      const actions = document.createElement('div');
      actions.className = 'job-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger small';
      deleteBtn.textContent = 'Delete job';

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this job/shift? This cannot be undone.')) return;
        data.jobs = data.jobs.filter((j) => j.id !== job.id);
        saveData(data);
        if (window._crewtechRerenderAll) window._crewtechRerenderAll();
        else { renderJobsTable(data); renderOverview(data); }
      });

      actions.appendChild(deleteBtn);
      details.appendChild(actions);

      let open = false;
      headerRow.addEventListener('click', () => {
        open = !open;
        details.style.display = open ? 'block' : 'none';
        arrowRow.textContent = open ? '▾' : '▸';
      });

      row.appendChild(headerRow);
      row.appendChild(details);
      body.appendChild(row);
    });

    monthGroup.appendChild(header);
    monthGroup.appendChild(body);
    container.appendChild(monthGroup);
  });
}

/* ========== CSV Export ========== */
function exportCsv(data) {
  if (!data.jobs.length) {
    alert('No jobs to export yet.');
    return;
  }

  const lines = [];
  lines.push(['Job Name', 'Date', 'Start', 'End', 'Booth', 'Location', 'Phase', 'Assignments'].join(','));

  data.jobs.forEach((job) => {
    const assignments = getAssignments(job);
    const assignStr = assignments
      .map((a) => {
        const w = data.workers.find((ww) => ww.id === a.workerId);
        if (!w) return null;
        return a.status ? `${w.name}: ${a.status}` : w.name;
      })
      .filter(Boolean)
      .join(' | ');

    const row = [
      job.name || '',
      job.date || '',
      job.startTime || '',
      job.endTime || '',
      job.booth || '',
      job.location || '',
      job.phase || '',
      assignStr
    ].map((v) => '"' + String(v).replace(/"/g, '""') + '"');

    lines.push(row.join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crewtech-jobs.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========== Backup Helpers ========== */
function setBackupStatus(message, isError = false) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

function exportBackupJson(data) {
  try {
    const workers = Array.isArray(data.workers) ? data.workers : [];
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    const backup = { version: 1, createdAt: new Date().toISOString(), workers, jobs };
    const json = JSON.stringify(backup, null, 2);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `crewtech-backup-${yyyy}-${mm}-${dd}.json`;

    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const workerCount = workers.length;
    const jobCount = jobs.length;
    setBackupStatus(`Backup downloaded (${workerCount} worker${workerCount === 1 ? '' : 's'}, ${jobCount} job${jobCount === 1 ? '' : 's'}).`);
  } catch (err) {
    console.error('Error creating backup JSON:', err);
    setBackupStatus('Error creating backup file.', true);
    alert('Error creating backup file: ' + err.message);
  }
}

function importBackupFromFile(file, data, rerenderAll) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const text = event.target.result;
      const backup = JSON.parse(text);
      if (!backup || typeof backup !== 'object') throw new Error('Backup file is not a valid JSON object.');

      const workers = Array.isArray(backup.workers) ? backup.workers : [];
      const jobs = Array.isArray(backup.jobs) ? backup.jobs : [];

      const workerCount = workers.length;
      const jobCount = jobs.length;

      const ok = confirm(
        `Restore backup with ${workerCount} worker${workerCount === 1 ? '' : 's'} and ${jobCount} job${jobCount === 1 ? '' : 's'}?\n\nThis will replace the current data on this device.`
      );
      if (!ok) { setBackupStatus('Restore cancelled.'); return; }

      data.workers = workers;
      data.jobs = jobs;
      saveData(data);
      rerenderAll();

      setBackupStatus(`Restored ${workerCount} worker${workerCount === 1 ? '' : 's'} and ${jobCount} job${jobCount === 1 ? '' : 's'} from backup.`);
    } catch (err) {
      console.error('Error restoring from backup:', err);
      setBackupStatus('Error restoring from backup file.', true);
      alert('Error restoring from backup: ' + err.message);
    }
  };
  reader.onerror = () => {
    console.error('FileReader error while reading backup file.');
    setBackupStatus('Error reading backup file.', true);
    alert('Error reading backup file.');
  };
  reader.readAsText(file);
}

/* ========== Cloud (Workers) Helpers ========== */
function setWorkersCloudStatus(message, isError = false) {
  const el = document.getElementById('workers-cloud-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? '#b91c1c' : '#6b7280';
}

async function saveWorkersToCloud(workers) {
  if (!WORKERS_CLOUD_URL) { alert('Cloud URL is not set in the app.'); return; }
  try {
    setWorkersCloudStatus('Saving workers to cloud...');
    const payload = { workers: workers || [] };
    const response = await fetch(WORKERS_CLOUD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || ('HTTP ' + response.status));
    const count = payload.workers.length || 0;
    setWorkersCloudStatus(`Saved ${count} worker${count === 1 ? '' : 's'} to cloud.`);
  } catch (err) {
    console.error('Error saving workers to cloud:', err);
    setWorkersCloudStatus('Error saving workers to cloud.', true);
    alert('Error saving workers to cloud: ' + err.message);
  }
}

async function loadWorkersFromCloud() {
  if (!WORKERS_CLOUD_URL) { alert('Cloud URL is not set in the app.'); return []; }
  try {
    setWorkersCloudStatus('Loading workers from cloud...');
    const response = await fetch(WORKERS_CLOUD_URL, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || ('HTTP ' + response.status));
    }
    const json = await response.json();
    const workersFromCloud = json.workers || [];
    const count = workersFromCloud.length || 0;
    setWorkersCloudStatus(`Loaded ${count} worker${count === 1 ? '' : 's'} from cloud.`);
    return workersFromCloud;
  } catch (err) {
    console.error('Error loading workers from cloud:', err);
    setWorkersCloudStatus('Error loading workers from cloud.', true);
    alert('Error loading workers from cloud: ' + err.message);
    return [];
  }
}

/* ========== Main Boot ========== */
document.addEventListener('DOMContentLoaded', () => {
  let data = loadData();



  const workersList = document.getElementById('workers-list');
  const showWorkersBtn = document.getElementById('show-workers-btn');
  const resetDataBtn = document.getElementById('reset-data-btn'); // optional
  const addWorkerBtn = document.getElementById('add-worker-btn');
  const addJobBtn = document.getElementById('add-job-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn'); // optional
  const seeAllJobsBtn = document.getElementById('see-all-jobs-btn');
  const allJobsSection = document.getElementById('all-jobs-section');
  
// Scroll "See All Jobs" to the All Jobs section
if (seeAllJobsBtn && allJobsSection) {
  seeAllJobsBtn.addEventListener('click', () => {
    allJobsSection.setAttribute('tabindex', '-1'); // a11y focus target
    allJobsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    allJobsSection.focus({ preventScroll: true });
    setTimeout(() => allJobsSection.removeAttribute('tabindex'), 300);
  });
}

  const addJobToggle = document.getElementById('add-job-toggle');
  const addJobBody   = document.getElementById('add-job-body');

  function setAddJobOpen(isOpen) {
    if (!addJobToggle || !addJobBody) return;
    addJobToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    addJobBody.style.display = isOpen ? 'block' : 'none';
  }

  if (addJobToggle) {
    addJobToggle.addEventListener('click', () => {
      const open = addJobToggle.getAttribute('aria-expanded') === 'true';
      setAddJobOpen(!open);
    });
    addJobToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const open = addJobToggle.getAttribute('aria-expanded') === 'true';
        setAddJobOpen(!open);
      }
    });
    setAddJobOpen(false);
  }

  const autoFillBtn = document.getElementById('auto-fill-btn');

  // Backup elements
  const backupDownloadLink = document.getElementById('backup-download-link');
  const backupRestoreLink = document.getElementById('backup-restore-link');
  const backupFileInput = document.getElementById('backup-file-input');

  function rerenderAll() {
    data.jobs.forEach((job) => getAssignments(job));
    saveData(data);
    renderAssignWorkers(data);
    renderWorkersTable(data);
    renderJobsTable(data);
    renderOverview(data);
  }

  rerenderAll();
  window._crewtechRerenderAll = rerenderAll;

  /* Backup: Download full JSON backup */
  if (backupDownloadLink) {
    backupDownloadLink.addEventListener('click', () => exportBackupJson(data));
  }

  /* Backup: Restore from JSON backup file */
  if (backupRestoreLink && backupFileInput) {
    backupRestoreLink.addEventListener('click', () => {
      backupFileInput.value = '';
      backupFileInput.click();
    });
    backupFileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      importBackupFromFile(file, data, rerenderAll);
    });
  }

  /* Workers cloud (optional buttons if you add them later) */
  const workersLoadCloudBtn = document.getElementById('workers-load-cloud-btn');
  const workersSaveCloudBtn = document.getElementById('workers-save-cloud-btn');

  if (workersSaveCloudBtn) {
    workersSaveCloudBtn.addEventListener('click', () => saveWorkersToCloud(data.workers));
  }
  if (workersLoadCloudBtn) {
    workersLoadCloudBtn.addEventListener('click', async () => {
      const loaded = await loadWorkersFromCloud();
      if (Array.isArray(loaded)) {
        data.workers = loaded;
        saveData(data);
        rerenderAll();
      }
    });
  }

  /* Auto-Fill Job */
  if (autoFillBtn) {
    autoFillBtn.addEventListener('click', () => {
      const raw = document.getElementById('raw-text').value.trim();
      if (!raw) {
        alert('Paste some job text from your boss first, then I can auto-fill.');
        return;
      }
      const parsed = parseJobText(raw);
      if (!parsed) {
        alert("I couldn't understand that yet. Try a format like:\n\nMAGIC Con – 11/12 – 8am–5pm – Booth 4012 – LVCC West Hall");
        return;
      }

      if (parsed.name) document.getElementById('job-name').value = parsed.name;
      if (parsed.date) document.getElementById('job-date').value = parsed.date;
      if (parsed.startTime) document.getElementById('job-start').value = parsed.startTime;
      if (parsed.endTime) document.getElementById('job-end').value = parsed.endTime;
      if (parsed.booth) document.getElementById('job-booth').value = parsed.booth;
      if (parsed.location) document.getElementById('job-location').value = parsed.location;
      if (parsed.phase) document.getElementById('job-phase').value = parsed.phase;

      setAddJobOpen(true);
      document.getElementById('add-job-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

      alert('Auto-Fill Job did its best guess.\nReview the fields below, tweak if needed, then click "Add Job".');
    });
  }

  /* Workers list toggle */
  if (showWorkersBtn && workersList) {
    showWorkersBtn.addEventListener('click', () => {
      const currentlyVisible = workersList.style.display !== 'none';
      workersList.style.display = currentlyVisible ? 'none' : 'block';
      showWorkersBtn.textContent = currentlyVisible ? 'Show list' : 'Hide list';
    });
  }

  /* Optional reset/export buttons if you add them in HTML later */
  if (resetDataBtn) {
    resetDataBtn.addEventListener('click', () => {
      if (!confirm('Reset ALL CrewTech data on this device?')) return;
      data = { workers: [], jobs: [] };
      saveData(data);
      rerenderAll();
    });
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => exportCsv(data));
  }

  /* Add worker */
  if (addWorkerBtn) {
    addWorkerBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('worker-name');
      const phoneInput = document.getElementById('worker-phone');

      const name = nameInput.value.trim();
      const phone = phoneInput.value.trim();

      if (!name) { alert('Enter a worker name.'); return; }

      const newWorker = { id: generateId('w'), name, phone };
      data.workers.push(newWorker);
      saveData(data);
      nameInput.value = '';
      phoneInput.value = '';
      rerenderAll();

      workersList.style.display = 'block';
      if (showWorkersBtn) showWorkersBtn.textContent = 'Hide list';
    });
  }

  /* Add job */
  if (addJobBtn) {
    addJobBtn.addEventListener('click', () => {
      const name = document.getElementById('job-name').value.trim();
      const date = document.getElementById('job-date').value;
      const startTime = document.getElementById('job-start').value;
      const endTime = document.getElementById('job-end').value;
      const booth = document.getElementById('job-booth').value.trim();
      const location = document.getElementById('job-location').value.trim();
      const notes = document.getElementById('job-notes').value.trim();
      const rawText = document.getElementById('raw-text').value.trim();
      const phase = document.getElementById('job-phase').value;

      if (!name || !date) { alert('At minimum, enter a job name and date.'); return; }

      const selectedWorkerIds = Array.from(
        document.querySelectorAll('#assign-workers input[type="checkbox"]:checked')
      ).map((cb) => cb.value);

      const assignments = selectedWorkerIds.map((id) => ({ workerId: id, status: 'Invited' }));

      const job = {
        id: generateId('j'),
        name, date, startTime, endTime, booth, location, notes, rawText, phase,
        assignments,
        assignedWorkerIds: selectedWorkerIds
      };

      data.jobs.push(job);
      saveData(data);

      document.getElementById('job-name').value = '';
      document.getElementById('job-date').value = '';
      document.getElementById('job-start').value = '';
      document.getElementById('job-end').value = '';
      document.getElementById('job-booth').value = '';
      document.getElementById('job-location').value = '';
      document.getElementById('job-notes').value = '';
      document.getElementById('raw-text').value = '';
      document.getElementById('job-phase').value = '';
      document.querySelectorAll('#assign-workers input[type="checkbox"]').forEach((cb) => (cb.checked = false));

      rerenderAll();
    });
  }

  /* Splash screen: show briefly, then slide/fade away */
  const splash = document.getElementById('splash-overlay');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('splash-hide');
      splash.addEventListener('transitionend', () => {
        if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
      }, { once: true });
    }, 1400);
  }
});

/* ===== Timesheet Assistant Toggle ===== */
function toggleTimesheetAssistant() {
  const body = document.getElementById('timesheet-assistant-body');
  const caret = document.getElementById('ts-caret');
  if (!body) return;
  const isHidden = body.style.display === 'none' || body.style.display === '';
  body.style.display = isHidden ? 'block' : 'none';
  if (caret) caret.textContent = isHidden ? '▾' : '▸';
}

/* ===== Timesheet Assistant Logic ===== */
(function initTimesheetAssistant() {
  const transcriptEl = document.getElementById('ts-transcript');
  const outputTableEl = document.getElementById('ts-outputTable');
  const csvOutputEl = document.getElementById('ts-csvOutput');
  const historyEl = document.getElementById('ts-history');

  const recordBtn = document.getElementById('ts-recordBtn');
  const generateBtn = document.getElementById('ts-generateBtn');
  const copyBtn = document.getElementById('ts-copyBtn');
  const downloadBtn = document.getElementById('ts-downloadBtn');

  if (!transcriptEl || !recordBtn) return;

  let recognition = null;
  let isRecording = false;

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript.trim() + '. ';
      }
      if (finalTranscript) {
        transcriptEl.value += (transcriptEl.value ? '\n' : '') + finalTranscript.trim();
      }
    };

    recognition.onend = () => {
      isRecording = false;
      recordBtn.textContent = '🎤 Start Recording';
    };
  } else {
    recordBtn.textContent = '🎤 Mic not supported';
  }

  recordBtn.addEventListener('click', () => {
    if (!recognition) {
      alert('Speech recognition is not supported in this browser. You can still type your entries.');
      return;
    }
    if (!isRecording) {
      recognition.start();
      isRecording = true;
      recordBtn.textContent = '⏹ Stop Recording';
    } else {
      recognition.stop();
      isRecording = false;
      recordBtn.textContent = '🎤 Start Recording';
    }
  });

  function parseTimeToMinutes(str) {
    if (!str) return null;
    const match = str.trim().match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    let minute = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3] ? match[3].toLowerCase() : null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  function formatHours(startStr, endStr) {
    const start = parseTimeToMinutes(startStr);
    const end = parseTimeToMinutes(endStr);
    if (start == null || end == null || end <= start) return '';
    const diff = (end - start) / 60;
    return diff.toFixed(2);
  }

  function parseTranscript(text) {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
    const rows = [];
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 5) continue;
      const [date, worker, location, start, end] = parts;
      const hours = formatHours(start, end);
      rows.push({ date, worker, location, start, end, hours });
    }
    return rows;
  }

  function renderTable(rows) {
    if (!rows.length) {
      outputTableEl.innerHTML = '<p class="muted">No valid lines found. Make sure each line follows the example format.</p>';
      csvOutputEl.value = '';
      return;
    }

    let html =
      '<table class="ts-table"><thead><tr>' +
      '<th>Date</th><th>Worker</th><th>Location</th><th>Start</th><th>End</th><th>Hours</th>' +
      '</tr></thead><tbody>';

    let csv = 'Date,Worker,Location,Start,End,Hours\n';

    rows.forEach((row) => {
      html += `<tr>
        <td>${row.date}</td>
        <td>${row.worker}</td>
        <td>${row.location}</td>
        <td>${row.start}</td>
        <td>${row.end}</td>
        <td>${row.hours}</td>
      </tr>`;
      csv += `"${row.date}","${row.worker}","${row.location}","${row.start}","${row.end}","${row.hours}"\n`;
    });

    html += '</tbody></table>';
    outputTableEl.innerHTML = html;
    csvOutputEl.value = csv.trim();

    const stamp = new Date().toLocaleString();
    historyEl.textContent = `Last generated: ${stamp} (${rows.length} row${rows.length === 1 ? '' : 's'})`;
  }

  generateBtn.addEventListener('click', () => {
    const text = transcriptEl.value.trim();
    if (!text) { alert('Add some lines first (by speaking or typing) before generating.'); return; }
    const rows = parseTranscript(text);
    renderTable(rows);
  });

  copyBtn.addEventListener('click', async () => {
    if (!csvOutputEl.value) { alert('Nothing to copy yet.'); return; }
    try {
      await navigator.clipboard.writeText(csvOutputEl.value);
      alert('CSV copied to clipboard.');
    } catch (e) {
      alert('Unable to copy. You can still select and copy manually.');
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!csvOutputEl.value) { alert('Nothing to download yet.'); return; }
    const blob = new Blob([csvOutputEl.value], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'timesheet.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
