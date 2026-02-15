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

/* ================= Sync Strip (Supabase truth + offline hedge) ================= */
const __crewtechSync = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  pendingWrites: 0,
  lastSyncAt: null
};

function fmtTimeShort(iso) {
  try {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

function setSyncStrip(state = {}) {
  try {
    Object.assign(__crewtechSync, state);
    const el = document.getElementById('sync-strip');
    if (!el) return;
    // Ensure strip is visible (HTML has display:none by default)
    el.style.display = 'block';

    const online = !!__crewtechSync.online;
    const syncing = !!__crewtechSync.syncing;
    const pending = Number(__crewtechSync.pendingWrites || 0);
    const last = __crewtechSync.lastSyncAt ? fmtTimeShort(__crewtechSync.lastSyncAt) : '';

    // Class + message (keep it minimal)
    el.classList.remove('ok', 'warn', 'err');

    if (!online) {
      el.classList.add('warn');
      el.textContent = pending > 0
        ? `Offline — ${pending} pending`
        : 'Offline — changes may not sync';
      return;
    }

    if (syncing) {
      el.classList.add('warn');
      el.textContent = pending > 0
        ? `Syncing… (${pending} pending)`
        : 'Syncing…';
      return;
    }

    // Online + idle
    el.classList.add('ok');
    if (pending > 0) {
      el.textContent = `${pending} pending — will sync`;
    } else if (last) {
      el.textContent = `Live • last sync ${last}`;
    } else {
      el.textContent = 'Live';
    }
  } catch (_) {}
}

// Online/offline events
try {
  window.addEventListener('online', () => setSyncStrip({ online: true }));
  window.addEventListener('offline', () => setSyncStrip({ online: false }));
} catch (_) {}

window.__crewtechSync = __crewtechSync;
/* ================= /Sync Strip ================= */


function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function sortJobsByDateTime(jobs) {
  return [...(jobs || [])].sort((a, b) => {
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
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
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
  const { origin, pathname } = window.location;
  let basePath = pathname.replace(/index\.html$/, '');
  basePath = basePath.replace(/\/$/, '');
  return `${origin}${basePath}/worker.html`;
}

// ===== SMS Queue Helpers (local SMS composer) =====
function buildWorkerInviteSmsMessage(job, worker) {
  var base = getBaseWorkerUrl();
  var link = base + '?workerId=' + encodeURIComponent(worker.id);
  var when = ((job.date || '') + ' ' + (job.startTime || '') + '-' + (job.endTime || '')).trim();
  return 'CrewTech: ' + (job.name || 'Job') + ' on ' + when + '. View details & confirm: ' + link;
}

function openSmsComposer(phone, message) {
  var to = String(phone || '').trim();
  if (!to) {
    alert('Missing worker phone number.');
    return false;
  }
  var body = encodeURIComponent(String(message || ''));
  // iOS commonly supports sms:NUMBER&body=...
  window.location.href = 'sms:' + encodeURIComponent(to) + '&body=' + body;
  return true;
}

function buildSmsQueueForJob(job, data) {
  return getAssignments(job)
    .map(function (a) {
      var w = (data.workers || []).find(function (ww) {
        return ww.id === a.workerId;
      });
      if (!w || !w.phone) return null;
      return {
        workerId: w.id,
        name: w.name || '(no name)',
        phone: w.phone,
        message: buildWorkerInviteSmsMessage(job, w),
        status: 'pending'
      };
    })
    .filter(Boolean);
}



// ===== SMS Queue Modal (manual SMS sending) =====
function showSmsQueueModal(job, queue) {
  // Remove any existing modal
  var existing = document.getElementById('sms-queue-modal');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  var overlay = document.createElement('div');
  overlay.id = 'sms-queue-modal';
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.55)';
  overlay.style.zIndex = '9999';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';

  var card = document.createElement('div');
  card.style.width = 'min(720px, 96vw)';
  card.style.maxHeight = '86vh';
  card.style.overflow = 'auto';
  card.style.background = '#fff';
  card.style.borderRadius = '18px';
  card.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)';
  card.style.padding = '14px';

  var title = document.createElement('div');
  title.style.fontWeight = '700';
  title.style.fontSize = '16px';
  title.style.marginBottom = '6px';
  title.textContent = 'Send SMS Invites (Manual)';

  var subtitle = document.createElement('div');
  subtitle.style.fontSize = '13px';
  subtitle.style.color = '#6b7280';
  subtitle.style.marginBottom = '10px';

  var jobLine = (job && job.name ? job.name : 'Job') + ' • ' + (job && job.date ? job.date : '');
  subtitle.textContent = jobLine;

  var progress = document.createElement('div');
  progress.style.fontSize = '13px';
  progress.style.margin = '10px 0 12px 0';
  progress.style.padding = '10px';
  progress.style.border = '1px solid #e5e7eb';
  progress.style.borderRadius = '12px';
  progress.style.background = '#f9fafb';

  function countDone() {
    var done = 0;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].status === 'sent' || queue[i].status === 'skipped') done++;
    }
    return done;
  }

  function renderProgress() {
    var done = countDone();
    progress.textContent = 'Progress: ' + done + ' / ' + queue.length;
  }

  var list = document.createElement('div');

  function renderList() {
    list.innerHTML = '';

    if (!queue.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No workers with phone numbers on this job.';
      list.appendChild(p);
      renderProgress();
      return;
    }

    queue.forEach(function (item, idx) {
      var row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '10px';
      row.style.border = '1px solid #e5e7eb';
      row.style.borderRadius = '12px';
      row.style.marginBottom = '8px';
      row.style.background = item.status === 'sent'
        ? '#ecfdf5'
        : item.status === 'skipped'
        ? '#f3f4f6'
        : '#ffffff';

      var left = document.createElement('div');
      left.style.display = 'flex';
      left.style.flexDirection = 'column';
      left.style.gap = '2px';

      var name = document.createElement('div');
      name.style.fontWeight = '700';
      name.style.fontSize = '14px';
      name.textContent = (idx + 1) + ') ' + (item.name || '(no name)');

      var phone = document.createElement('div');
      phone.style.fontSize = '12px';
      phone.style.color = '#6b7280';
      phone.textContent = item.phone || '';

      var status = document.createElement('div');
      status.style.fontSize = '12px';
      status.style.color = '#6b7280';
      status.textContent =
        item.status === 'sent' ? 'Sent' : item.status === 'skipped' ? 'Skipped' : 'Pending';

      left.appendChild(name);
      left.appendChild(phone);
      left.appendChild(status);

      var right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.flexWrap = 'wrap';
      right.style.justifyContent = 'flex-end';

      var sendBtn = document.createElement('button');
      sendBtn.className = 'secondary small';
      sendBtn.textContent = 'Send SMS';
      sendBtn.disabled = item.status === 'sent' || item.status === 'skipped';

      sendBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        // Open the native SMS composer (user hits Send there)
        openSmsComposer(item.phone, item.message);
        // We can't detect if user actually sent, so we mark as sent once opened
        item.status = 'sent';
        renderList();
        renderProgress();
      });

      var skipBtn = document.createElement('button');
      skipBtn.className = 'small';
      skipBtn.textContent = 'Skip';
      skipBtn.disabled = item.status === 'sent' || item.status === 'skipped';

      skipBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        item.status = 'skipped';
        renderList();
        renderProgress();
      });

      right.appendChild(sendBtn);
      right.appendChild(skipBtn);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    renderProgress();
  }

  var footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.gap = '10px';
  footer.style.marginTop = '12px';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'danger small';
  closeBtn.textContent = 'Done / Close';
  closeBtn.addEventListener('click', function () {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  });

  var hint = document.createElement('div');
  hint.style.fontSize = '12px';
  hint.style.color = '#6b7280';
  hint.style.alignSelf = 'center';
  hint.textContent = 'Tip: tap “Send SMS”, send in Messages, then come back here for the next worker.';

  footer.appendChild(hint);
  footer.appendChild(closeBtn);

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(progress);
  card.appendChild(list);
  card.appendChild(footer);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Close when tapping the dark overlay (mobile-friendly)
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  });

  renderList();
  renderProgress();
}


/* ========== Assignment / Phase Helpers ========== */
function getAssignments(job) {
  if (!Array.isArray(job.assignments)) {
    const baseIds = job.assignedWorkerIds || [];
    job.assignments = baseIds.map((id) => ({
      workerId: id,
      status: ''
    }));
  }

  // Always keep assignedWorkerIds in sync
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

/* ========== Auto-Fill Parser ========== */
function normalizeCoverSheetText(raw) {
  const text = (raw || '').trim();
  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const keep = [];

  // helper to safely get next N lines joined
  function joinNext(i, count) {
    const parts = [];
    for (let k = 0; k < count; k++) {
      const line = lines[i + k + 1];
      if (line) parts.push(line.trim());
    }
    return parts.join(' ');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Show name like: "Show:" then later "DevLearn 2025"
    if (/^show\s*:/i.test(line)) {
      const value = joinNext(i, 3); // look a few lines ahead
      keep.push(line + ' ' + value);
      continue;
    }

    // Booth: label then number on next line
    if (/booth\s*#/i.test(line) || /^booth\s*:/i.test(line)) {
      const value = joinNext(i, 1);
      keep.push(line + ' ' + value);
      continue;
    }

    // Show Site + City/State for location
    if (/^show site\s*:/i.test(line)) {
      const value = joinNext(i, 1);
      keep.push(line + ' ' + value);
      continue;
    }
    if (/^city\/state\s*:/i.test(line)) {
      const value = joinNext(i, 1);
      keep.push(line + ' ' + value);
      continue;
    }

    // Installation section
    if (/installation\s*:?/i.test(line)) {
      const value = joinNext(i, 4);
      if (value) keep.push('Installation: ' + value);
      continue;
    }

    // Show Dates section
    if (/show dates?/i.test(line)) {
      const value = joinNext(i, 2);
      if (value) keep.push('Show Dates: ' + value);
      continue;
    }

    // Dismantle / Strike section
    if (/dismantle/i.test(line) || /dismantling/i.test(line)) {
      const value = joinNext(i, 4);
      if (value) keep.push('Dismantle: ' + value);
      continue;
    }

    // Everything else is ignored for now
  }

  if (!keep.length) return raw;

  return keep.join('\n');
}

/**
 * Parse freeform convention job text into structured data.
 */
function parseJobFromText(rawText) {
  const originalNotes = (rawText || '').trim();
  const errors = [];
  const result = {
    jobName: null,
    dates: [],
    startTime: null,
    endTime: null,
    hall: null,
    booth: null,
    numWorkers: null,
    phase: null,
    shifts: [],
    notes: originalNotes,
    errors
  };

  let notes = normalizeCoverSheetText(originalNotes);

  if (!notes) {
    errors.push('No text provided.');
    return result;
  }

  const lines = notes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lower = notes.toLowerCase();
  const currentYear = new Date().getFullYear();

  // Job name: first non-empty line that doesn't look like a date; fallback to old leading segment logic.
  if (lines.length) {
    const firstLine = lines[0];
    const hasDate = /\d{1,2}[\/\-]\d{1,2}/.test(firstLine);
    if (firstLine && !hasDate) {
      result.jobName = firstLine;
    }
  }
  if (!result.jobName) {
    const leadingSegment = notes.split(/[-–]/)[0].trim();
    if (leadingSegment && !/\d/.test(leadingSegment)) {
      result.jobName = leadingSegment;
    }
  }
  if (!result.jobName) {
    for (const line of lines) {
      const m = line.match(/show\s*:\s*(.+)/i);
      if (m && m[1]) {
        result.jobName = m[1].trim();
        break;
      }
    }
  }

  // Dates like 11/24 or 11-24-2025 (allow multiple).
  const dateRegex = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/g;
  const seenDates = new Set();
  for (const match of notes.matchAll(dateRegex)) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = match[3] ? parseInt(match[3], 10) : currentYear;
    if (year < 100) year += 2000;
    const iso =
      String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    if (!seenDates.has(iso)) {
      seenDates.add(iso);
      result.dates.push(iso);
    }
  }

  // Time ranges: 8a-4p, 7am-3pm, 9-5, 5pm-9pm.
  const timeRangeRegex =
    /(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm)?)\s*(?:to|[-–]|\/)\s*(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm)?)/gi;
  const timeCandidates = [];

  const rawLines = notes.split(/\r?\n/);
  let offset = 0;
  const lineSpans = rawLines.map((line) => {
    const start = offset;
    const end = start + line.length;
    offset = end + 1; // account for newline
    return { line, start, end };
  });

  for (const match of notes.matchAll(timeRangeRegex)) {
    const startRaw = match[1];
    const endRaw = match[2];
    const idx = match.index || 0;
    let lineText = '';
    for (const span of lineSpans) {
      if (idx >= span.start && idx <= span.end) {
        lineText = span.line.trim();
        break;
      }
    }
    timeCandidates.push({ startRaw, endRaw, lineText });
  }

  function pickTimeCandidate(candidates) {
    if (!candidates.length) return null;

    const withAmPm = candidates.filter(
      (c) => /[ap]m/i.test(c.startRaw || '') || /[ap]m/i.test(c.endRaw || '')
    );
    const pool = withAmPm.length ? withAmPm : candidates;

    const hasShowDaily = pool.find((c) =>
      /(show|daily)/i.test(c.lineText || '')
    );
    if (hasShowDaily) return hasShowDaily;

    const notSetupStrike = pool.find(
      (c) =>
        !/(setup|set up|build|strike|dismantle|tear down)/i.test(
          c.lineText || ''
        )
    );
    if (notSetupStrike) return notSetupStrike;

    return pool[0];
  }

  const chosenTime = pickTimeCandidate(timeCandidates);

  function normalizeTimeCandidate(val) {
    if (!val) return null;
    let s = String(val).trim().toLowerCase();
    s = s.replace(/([0-9])\s*([ap])\b/, '$1$2m').replace(/([0-9])([ap])\b/, '$1$2m');
    const m = s.match(/(\d{1,2})(?::(\d{2}))?(am|pm)?/);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3];
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function hasAmPm(val) {
    return /[ap]m?\b/i.test(val || '');
  }

  if (chosenTime) {
    const startRaw = chosenTime.startRaw;
    const endRaw = chosenTime.endRaw;
    let start = normalizeTimeCandidate(startRaw);
    let end = normalizeTimeCandidate(endRaw);

    // If both sides lacked AM/PM, assume daytime and roll forward when end <= start (e.g., 9-5).
    if (start && end && !hasAmPm(startRaw) && !hasAmPm(endRaw)) {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      let endMinutes = eh * 60 + em;
      if (endMinutes <= startMinutes) endMinutes += 12 * 60;
      const adjHour = Math.floor(endMinutes / 60) % 24;
      const adjMin = endMinutes % 60;
      end = String(adjHour).padStart(2, '0') + ':' + String(adjMin).padStart(2, '0');
    }

    result.startTime = start;
    result.endTime = end;
  }

  result.shifts = [];

  for (const c of timeCandidates) {
    const line = (c.lineText || '').toLowerCase();

    let phase = null;
    let type = null;

    if (/(strike|dismantle|dismantling|tear down)/i.test(line)) {
      phase = 'strike';
      type = 'strike';
    } else if (/(setup|set up|build|install|installation)/i.test(line)) {
      phase = 'setup';
      type = 'setup';
    } else if (/(show|assist|support|standby)/i.test(line)) {
      phase = 'assist';
      type = 'show';
    }

    if (!phase) continue;

    const start = normalizeTimeCandidate(c.startRaw);
    const end = normalizeTimeCandidate(c.endRaw);
    if (!start || !end) continue;

    result.shifts.push({
      type, // 'setup' | 'show' | 'strike'
      phase, // 'setup' | 'assist' | 'strike'
      startTime: start,
      endTime: end
    });
  }

  // Hall / location extraction: line-by-line, stop on first line containing hall keywords.
  for (const line of lines) {
    if (/(hall|expo|center|convention)/i.test(line)) {
      result.hall = line.trim();
      break;
    }
  }

  // Booth number.
  const boothMatch = notes.match(/booth\s*#?\s*([a-z0-9\-]+)/i);
  if (boothMatch && boothMatch[1]) {
    result.booth = boothMatch[1];
  }

  // Worker count.
  const workerMatch =
    lower.match(/(?:need\s+)?(\d+)\s*(?:workers?|staff|crew|people|ppl|guys?)/) ||
    lower.match(/need\s+(\d+)/);
  if (workerMatch && workerMatch[1]) {
    result.numWorkers = parseInt(workerMatch[1], 10);
  }

  // Phase: prefer the line with the chosen time, then fall back to overall text.
  const phaseLine = chosenTime && chosenTime.lineText ? chosenTime.lineText.toLowerCase() : '';
  if (
    phaseLine.includes('strike') ||
    phaseLine.includes('dismantle') ||
    phaseLine.includes('tear down')
  ) {
    result.phase = 'strike';
  } else if (
    phaseLine.includes('setup') ||
    phaseLine.includes('set up') ||
    phaseLine.includes('build') ||
    phaseLine.includes('install')
  ) {
    result.phase = 'setup';
  } else if (
    phaseLine.includes('show') ||
    phaseLine.includes('assist') ||
    phaseLine.includes('support') ||
    phaseLine.includes('standby')
  ) {
    result.phase = 'assist';
  }

  if (!result.phase) {
    if (
      lower.includes('strike') ||
      lower.includes('dismantle') ||
      lower.includes('tear down')
    ) {
      result.phase = 'strike';
    } else if (
      lower.includes('setup') ||
      lower.includes('set up') ||
      lower.includes('build') ||
      lower.includes('install')
    ) {
      result.phase = 'setup';
    } else if (
      lower.includes('show') ||
      lower.includes('assist') ||
      lower.includes('support') ||
      lower.includes('standby')
    ) {
      result.phase = 'assist';
    }
  }

  // Missing field warnings.
  if (!result.jobName) errors.push('No job name found.');
  if (!result.dates.length) errors.push('No date found.');
  if (!result.startTime || !result.endTime) errors.push('No time range found.');
  if (!result.hall) errors.push('No hall/location found.');
  if (!result.booth) errors.push('No booth number found.');
  if (result.numWorkers == null) errors.push('No worker count found.');
  if (!result.phase) errors.push('No phase found.');

  return result;
}

window.parseJobFromText = parseJobFromText;

/* ========== Workers Rendering ========== */
function renderAssignWorkers(data) {
  const container = document.getElementById('assign-workers');
  if (!container) return;

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

function getSelectedAssignWorkerIds() {
  const assignContainer = document.getElementById('assign-workers');
  if (!assignContainer) return [];
  return Array.from(
    assignContainer.querySelectorAll('input[type="checkbox"]:checked')
  ).map((cb) => cb.value);
}

function restoreAssignWorkerSelection(ids) {
  const assignContainer = document.getElementById('assign-workers');
  if (!assignContainer || !ids) return;
  const selectedSet = new Set(ids);
  assignContainer
    .querySelectorAll('input[type="checkbox"]')
    .forEach((cb) => (cb.checked = selectedSet.has(cb.value)));
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
    });

    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    table.appendChild(tr);
  });
}

/* ========== Job Summary Helpers ========== */
function buildWorkerSummary(job, data, hideInviteStatusSummary = false) {
  const assignments = getAssignments(job);
  const workerCount = assignments.length;
  if (!workerCount) return '0 workers';

  const baseText = `${workerCount} worker${workerCount > 1 ? 's' : ''}`;
  if (hideInviteStatusSummary) return baseText;

  let confirmed = 0,
    invited = 0,
    declined = 0,
    other = 0;
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

  return baseText + (parts.length ? ` (${parts.join(', ')})` : '');
}

function calcHours(start, end) {
  if (!start || !end) return '';
  const s = new Date(`2000-01-01T${start}`);
  const e = new Date(`2000-01-01T${end}`);
  if (isNaN(s) || isNaN(e)) return '';

  const diffMs = e - s;
  if (diffMs <= 0) return '';

  let hours = diffMs / (1000 * 60 * 60);
  hours = Math.round(hours * 4) / 4; // round to nearest quarter-hour

  return hours.toString();
}

/* ========== Shared Renderer for Month-Grouped Job Lists ========== */
function renderJobGroups(container, jobs, data, options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const list = sortJobsByDateTime(jobs || []);
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = options.emptyText || 'No jobs yet.';
    container.appendChild(p);
    return;
  }

  const groups = {};
  list.forEach((job) => {
    const key = getMonthKey(job.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(job);
  });

  const keys = Object.keys(groups).sort();

  const today = new Date();
  const currentKey =
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

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
    count.textContent =
      groups[key].length + ' job' + (groups[key].length > 1 ? 's' : '');

    const arrow = document.createElement('div');
    arrow.className = 'month-arrow';
    arrow.textContent =
      key === currentKey && !options.startCollapsed ? '▾' : '▸';

    right.appendChild(count);
    right.appendChild(arrow);

    header.appendChild(title);
    header.appendChild(right);

    const body = document.createElement('div');
    body.className = 'month-body';
    body.style.display =
      key === currentKey && !options.startCollapsed ? 'block' : 'none';

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

      const timeText = [job.startTime, job.endTime]
        .filter(Boolean)
        .map(formatTime)
        .join(' – ');

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
      workersSummary.textContent = buildWorkerSummary(
        job,
        data,
        options.hideInviteStatusSummary
      );
      metaLine.appendChild(workersSummary);

      // If report completed, show a tiny tag
      if (job.reportCompleted) {
        const doneSpan = document.createElement('span');
        doneSpan.className = 'job-row-finalized-tag';
        doneSpan.textContent = 'Finalized';
        metaLine.appendChild(doneSpan);
      }

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
      dateBlock.innerHTML =
        '<div class="job-details-label">Date</div>' +
        `<div class="job-details-value">${
          job.date ? formatDate(job.date) : '-'
        }</div>`;
      grid.appendChild(dateBlock);

      const timeBlock = document.createElement('div');
      const timeFull = timeText || '-';
      timeBlock.innerHTML =
        '<div class="job-details-label">Time</div>' +
        `<div class="job-details-value">${timeFull}</div>`;
      grid.appendChild(timeBlock);

      const boothBlock = document.createElement('div');
      boothBlock.innerHTML =
        '<div class="job-details-label">Booth</div>' +
        `<div class="job-details-value">${job.booth || '-'}</div>`;
      grid.appendChild(boothBlock);

      const locBlock = document.createElement('div');
      locBlock.innerHTML =
        '<div class="job-details-label">Location</div>' +
        `<div class="job-details-value">${job.location || '-'}</div>`;
      grid.appendChild(locBlock);

      details.appendChild(grid);

      const notesText =
        options.useFinalizedNotes && job.finalizedNotes
          ? job.finalizedNotes
          : job.notes;
      if (notesText) {
        const notesBlock = document.createElement('div');
        notesBlock.className = 'job-notes-block';
        notesBlock.innerHTML =
          '<div class="job-details-label">Notes</div>' +
          `<div class="job-details-value">${notesText}</div>`;
        details.appendChild(notesBlock);
      }

      if (job.rawText) {
        const rawBlock = document.createElement('div');
        rawBlock.className = 'job-notes-block';
        rawBlock.innerHTML =
          '<div class="job-details-label">Raw text</div>' +
          `<div class="job-details-value">${job.rawText}</div>`;
        details.appendChild(rawBlock);
      }

      // Workers & status pills
      const workersBlock = document.createElement('div');
      workersBlock.className = 'job-workers-block';

      const workersLabel = document.createElement('div');
      workersLabel.className = 'job-details-label';
      workersLabel.textContent =
        options.hideInviteStatusSummary ? 'Workers' : 'Workers & Status';
      workersBlock.appendChild(workersLabel);

      const assignments = getAssignments(job);
      if (!assignments.length) {
        const noWorkers = document.createElement('div');
        noWorkers.className = 'job-details-value';
        noWorkers.textContent = 'No workers assigned yet.';
        workersBlock.appendChild(noWorkers);
      } else {
        const showInviteBadges = !options.hideInviteBadges;
        assignments.forEach((assignment) => {
          const w = data.workers.find((ww) => ww.id === assignment.workerId);
          // If worker record isn't present locally, still show something (id) instead of hiding history.
          const workerLabel = w ? (w.name || w.id) : (assignment.workerId || '(unknown worker)');

          const rowW = document.createElement('div');
          rowW.className = 'worker-status-row';

          const nameSpanW = document.createElement('div');
          nameSpanW.className = 'worker-status-name';
          nameSpanW.textContent = workerLabel;
          // Completed/Finalized: show a tiny history hint for Cancelled workers
          try {
            const st = String(assignment.status || '').trim().toLowerCase();
            if (options && options.showCancelledTextInWorkers && (st === 'cancelled' || st === 'canceled')) {
              nameSpanW.textContent = workerLabel + ' (Cancelled)';
            }
          } catch (e) {}
          rowW.appendChild(nameSpanW);

          if (showInviteBadges) {
            const pills = document.createElement('div');
            pills.className = 'status-pills';

            const current = assignment.status || 'Invited';
            const currentNorm = String(current).trim().toLowerCase();

            [
              { value: 'Invited', label: 'Invited', cls: 'invited' },
              { value: 'Confirmed', label: 'Confirmed', cls: 'confirmed' },
              { value: 'Declined', label: 'Declined', cls: 'declined' },
              { value: 'Cancelled', label: 'Cancelled', cls: 'cancelled' }
            ].forEach((opt) => {
              const pill = document.createElement('span');
              pill.className = 'status-pill ' + opt.cls;
              if (currentNorm === String(opt.value).trim().toLowerCase()) pill.classList.add('active');
              pill.textContent = opt.label;

              pill.addEventListener('click', (e) => {
                e.stopPropagation();

                if (opt.value === 'Cancelled') {
                  const ok = confirm('Cancel this worker for this job? (Use Add Worker if you need a replacement.)');
                  if (!ok) return;
                }

                assignment.status = opt.value;

// Immediate UI feedback (don’t rely on rerender to show active pill)
try {
  pills.querySelectorAll('.status-pill').forEach((el) => el.classList.remove('active'));
  pill.classList.add('active');
} catch (e) {
  // ignore DOM issues; rerender will still fix it
}

// CRITICAL: always persist/sync the exact assignments array we're editing
job.assignments = assignments;
job.assignedWorkerIds = (assignments || []).map((a) => a.workerId);

saveData(data);

// Sync minimal payload so Supabase can’t accidentally overwrite other fields
if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
  if (window.syncJobToSupabaseClient) {
    window.syncJobToSupabaseClient({ id: job.id, assignments: job.assignments });
  } else {
    console.warn('[Admin] syncJobToSupabaseClient missing on window');
  }
}

                if (window._crewtechRerenderAll) window._crewtechRerenderAll();
              });

              pills.appendChild(pill);
            });

            rowW.appendChild(pills);
          }
          workersBlock.appendChild(rowW);
        });
      }

      

      // ---- Add Worker (Upcoming Jobs) ----
      // Hide Add Worker in Completed/Finalized views
      if (!(options && options.hideAddWorker) && !job.reportCompleted) {
      try {
        const addWrap = document.createElement('div');
        addWrap.className = 'job-add-worker';

        const addLabel = document.createElement('div');
        addLabel.className = 'job-details-label';
        addLabel.style.marginTop = '0.75rem';
        addLabel.textContent = 'Add Worker';
        addWrap.appendChild(addLabel);

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '0.5rem';
        row.style.flexWrap = 'wrap';
        row.style.alignItems = 'center';

        const sel = document.createElement('select');
        sel.className = 'small';
        sel.style.minWidth = '220px';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select worker…';
        placeholder.disabled = true;
        placeholder.selected = true;
        sel.appendChild(placeholder);

        function rebuildWorkerSelect() {
          // clear all but placeholder
          while (sel.options.length > 1) sel.remove(1);

          const activeAssignedIds = new Set(
  (assignments || [])
    .filter(a => {
      const st = String((a && a.status) || 'Invited').trim().toLowerCase();
      return st !== 'cancelled' && st !== 'canceled' && st !== 'declined';
    })
    .map(a => a.workerId)
);
          (data.workers || [])
            .filter(w => w && w.id && !activeAssignedIds.has(w.id))
            .forEach(w => {
              const opt = document.createElement('option');
              opt.value = w.id;
              opt.textContent = w.name || w.id;
              sel.appendChild(opt);
            });
        }

        rebuildWorkerSelect();

        const addBtn = document.createElement('button');
        addBtn.className = 'secondary small';
        addBtn.type = 'button';
        addBtn.textContent = 'Add Worker';

        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const workerId = sel.value;
          if (!workerId) return;

          const existing = (assignments || []).find(a => a.workerId === workerId);
          if (!existing) {
            assignments.push({ workerId, status: 'Invited' });
          } else {
            const st = String(existing.status || 'Invited').trim().toLowerCase();
            if (st === 'cancelled' || st === 'canceled' || st === 'declined') {
              existing.status = 'Invited';
            }
          }

          // persist + sync
          job.assignments = assignments;
          job.assignedWorkerIds = (assignments || []).map(a => a.workerId);
          saveData(data);

          if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
            if (window.syncJobToSupabaseClient) {
              window.syncJobToSupabaseClient({ id: job.id, assignments: job.assignments });
            } else {
              console.warn('[Admin] syncJobToSupabaseClient missing on window');
            }
          }

          if (window._crewtechRerenderAll) window._crewtechRerenderAll();
        });

        const addNewBtn = document.createElement('button');
        addNewBtn.className = 'small';
        addNewBtn.type = 'button';
        addNewBtn.textContent = 'Add New Worker';

        addNewBtn.addEventListener('click', (e) => {
          e.stopPropagation();

          const name = prompt('New worker name:');
          if (!name || !String(name).trim()) return;

          const phone = prompt('Phone (optional):') || '';
          const id = 'w_' + Math.random().toString(36).slice(2, 9);

          data.workers = Array.isArray(data.workers) ? data.workers : [];
          data.workers.push({ id, name: String(name).trim(), phone: String(phone).trim() });

          assignments.push({ workerId: id, status: 'Invited' });

          job.assignments = assignments;
          job.assignedWorkerIds = (assignments || []).map(a => a.workerId);

          saveData(data);

          // best-effort: upsert new worker too, if helper exists
          try {
            if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
              if (typeof upsertWorkerToSupabaseIfAvailable === 'function') {
                upsertWorkerToSupabaseIfAvailable({ id, name: String(name).trim(), phone: String(phone).trim() });
              }
              if (window.syncJobToSupabaseClient) {
                window.syncJobToSupabaseClient({ id: job.id, assignments: job.assignments });
              }
            }
          } catch (err) {}

          if (window._crewtechRerenderAll) window._crewtechRerenderAll();
        });

        row.appendChild(sel);
        row.appendChild(addBtn);
        row.appendChild(addNewBtn);

        addWrap.appendChild(row);
        workersBlock.appendChild(addWrap);
      } catch (e) {
        console.warn('[Admin] Add Worker UI failed to render', e);
      }


      }

      details.appendChild(workersBlock);

      // Actions row
      const actions = document.createElement('div');
      actions.className = 'job-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger small';
      deleteBtn.textContent = 'Delete job';

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this job/shift? This cannot be undone.')) return;

        // Remove locally first (fast UI)
        data.jobs = data.jobs.filter((j) => j.id !== job.id);
        saveData(data);
        if (window._crewtechRerenderAll) window._crewtechRerenderAll();

        // Best-effort delete in Supabase so it doesn't resurrect on refresh
        try {
          if (!['localhost','127.0.0.1'].includes(window.location.hostname)) {
            if (window.deleteJobFromSupabaseClient) {
              await window.deleteJobFromSupabaseClient(job.id);
            } else {
              console.warn('[Admin] deleteJobFromSupabaseClient missing on window');
            }
          }
        } catch (err) {}
      });

      if (!(options && options.hideSmsQueueButton)) {


      const smsQueueBtn = document.createElement('button');
      smsQueueBtn.className = 'secondary small';
      smsQueueBtn.textContent = 'SMS Queue';
      smsQueueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const queue = buildSmsQueueForJob(job, data);
        showSmsQueueModal(job, queue);
      });

      actions.appendChild(smsQueueBtn);
      }
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

/* ========== Upcoming Jobs – Mini & Full ========== */
function renderUpcomingMini(data, maxCount = 5) {
  const container = document.getElementById('next-jobs');
  if (!container) return;

  container.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = sortJobsByDateTime(data.jobs).filter((job) => {
    if (!job.date) return false;
    const d = new Date(job.date + 'T00:00:00');
    return !isNaN(d) && d >= today;
  });

  if (!upcoming.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No upcoming jobs yet.';
    container.appendChild(p);
    return;
  }

  upcoming.slice(0, maxCount).forEach((job) => {
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
      bits.push(
        [job.startTime, job.endTime]
          .filter(Boolean)
          .map(formatTime)
          .join(' – ')
      );
    }
    if (job.booth) bits.push('Booth ' + job.booth);
    if (job.location) bits.push(job.location);
    meta.textContent = bits.join(' • ');
    card.appendChild(meta);

    const assignments = getAssignments(job);
    if (assignments.length) {
      const workersDiv = document.createElement('div');
      workersDiv.className = 'job-card-workers';
      const names = assignments
        .map((a) => {
          const w = data.workers.find((ww) => ww.id === a.workerId);
          if (!w) return null;
          const abbrev = shortStatus(a.status);
          return abbrev ? `${w.name} (${abbrev})` : w.name;
        })
        .filter(Boolean);
      workersDiv.textContent = 'Workers: ' + names.join(', ');
      card.appendChild(workersDiv);
    }

    container.appendChild(card);
  });
}

function renderUpcomingFull(data) {
  const container = document.getElementById('jobs-upcoming-table');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const futureJobs = (data.jobs || []).filter((job) => {
    if (!job.date) return false;
    const d = new Date(job.date + 'T00:00:00');
    return !isNaN(d) && d >= today;
  });

  renderJobGroups(container, futureJobs, data, {
    emptyText: 'No future jobs yet.',
    startCollapsed: false
  });
}

/* ========== Completed Jobs (uses reportCompleted flag) ========== */
function renderCompletedJobs(data) {
  const container = document.getElementById('jobs-completed-table');
  if (!container) return;

  const completedJobs = (data.jobs || []).filter((job) => job.reportCompleted);
  renderJobGroups(container, completedJobs, data, {
    emptyText: 'No completed jobs yet.',
    startCollapsed: true,
    hideInviteStatusSummary: true,
    hideInviteBadges: true,
    useFinalizedNotes: true,
    hideAddWorker: true,
    hideSmsQueueButton: true,
    showCancelledTextInWorkers: true,

  });
}

/* ========== CSV Export (global jobs list) ========== */
function exportCsv(data) {
  if (!data.jobs.length) {
    alert('No jobs to export yet.');
    return;
  }

  const lines = [];
  lines.push(
    [
      'Job Name',
      'Date',
      'Start',
      'End',
      'Booth',
      'Location',
      'Phase',
      'Assignments'
    ].join(',')
  );

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

  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8;'
  });
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
  el.style.color = isError ? '#b91c1c' : '#fed7aa';
}

function exportBackupJson(data) {
  try {
    const workers = Array.isArray(data.workers) ? data.workers : [];
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];

    const backup = {
      version: 1,
      createdAt: new Date().toISOString(),
      workers,
      jobs
    };
    const json = JSON.stringify(backup, null, 2);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `crewtech-backup-${yyyy}-${mm}-${dd}.json`;

    const blob = new Blob([json], {
      type: 'application/json;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const workerCount = workers.length;
    const jobCount = jobs.length;
    setBackupStatus(
      `Backup downloaded (${workerCount} worker${
        workerCount === 1 ? '' : 's'
      }, ${jobCount} job${jobCount === 1 ? '' : 's'}).`
    );
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
      if (!backup || typeof backup !== 'object')
        throw new Error('Backup file is not a valid JSON object.');

      const workers = Array.isArray(backup.workers) ? backup.workers : [];
      const jobs = Array.isArray(backup.jobs) ? backup.jobs : [];

      const workerCount = workers.length;
      const jobCount = jobs.length;

      const ok = confirm(
        `Restore backup with ${workerCount} worker${
          workerCount === 1 ? '' : 's'
        } and ${jobCount} job${
          jobCount === 1 ? '' : 's'
        }?\n\nThis will replace the current data on this device.`
      );
      if (!ok) {
        setBackupStatus('Restore cancelled.');
        return;
      }

      data.workers = workers;
      data.jobs = jobs;
      saveData(data);
      rerenderAll();
      try { if (window.__crewtechSync) window.__crewtechSync.pendingWrites = 0; } catch(e) {}
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false, pendingWrites: 0, lastSyncAt: new Date().toISOString() });
      try { if (window.__crewtechSync) window.__crewtechSync.pendingWrites = 0; } catch(e) {}
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false, pendingWrites: 0, lastSyncAt: new Date().toISOString() });

      setBackupStatus(
        `Restored ${workerCount} worker${
          workerCount === 1 ? '' : 's'
        } and ${jobCount} job${jobCount === 1 ? '' : 's'} from backup.`
      );
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
  if (!WORKERS_CLOUD_URL) {
    alert('Cloud URL is not set in the app.');
    return;
  }
  try {
    setWorkersCloudStatus('Saving workers to cloud...');
    const payload = { workers: workers || [] };
    const response = await fetch(WORKERS_CLOUD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'HTTP ' + response.status);
    const count = payload.workers.length || 0;
    setWorkersCloudStatus(
      `Saved ${count} worker${count === 1 ? '' : 's'} to cloud.`
    );
  } catch (err) {
    console.error('Error saving workers to cloud:', err);
    setWorkersCloudStatus('Error saving workers to cloud.', true);
    alert('Error saving workers to cloud: ' + err.message);
  }
}

async function loadWorkersFromCloud() {
  if (!WORKERS_CLOUD_URL) {
    alert('Cloud URL is not set in the app.');
    return [];
  }
  try {
    setWorkersCloudStatus('Loading workers from cloud...');
    const response = await fetch(WORKERS_CLOUD_URL, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'HTTP ' + response.status);
    }
    const json = await response.json();
    const workersFromCloud = json.workers || [];
    const count = workersFromCloud.length || 0;
    setWorkersCloudStatus(
      `Loaded ${count} worker${count === 1 ? '' : 's'} from cloud.`
    );
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
  const resetDataBtn = document.getElementById('reset-data-btn'); // optional
  const addWorkerBtn = document.getElementById('add-worker-btn');
  const addJobBtn = document.getElementById('add-job-btn');
  const generateSampleJobsBtn = document.getElementById('generate-sample-jobs-btn');
  const generateFinalizableJobsBtn = document.getElementById('generate-finalizable-jobs-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn'); // optional

  const addJobToggle = document.getElementById('add-job-toggle');

  const workersSection = document.getElementById('workers-section');
  const workersToggle = document.getElementById('workers-toggle');
  const workersBody = document.getElementById('workers-body');

  const upcomingToggle = document.getElementById('upcoming-jobs-toggle');
  const upcomingBody = document.getElementById('upcoming-jobs-body');
  const upcomingSeeAllBtn = document.getElementById('upcoming-see-all-btn');
  const upcomingJobsFull = document.getElementById('upcoming-jobs-full');

  const completedToggle = document.getElementById('completed-jobs-toggle');
  const completedBody = document.getElementById('completed-jobs-body');

  const finalizeToggle = document.getElementById('finalize-toggle');
  const finalizeBody = document.getElementById('finalize-body');

  const finalizeJobSelect = document.getElementById('finalize-job-select');
  const finalizeWorkersContainer = document.getElementById('finalize-workers-container');
  const finalizeNotes = document.getElementById('finalize-notes');
  const finalizeExportBtn = document.getElementById('finalize-export-btn');
  const finalizeCompleteBtn = document.getElementById('finalize-complete-btn');
  const finalizeDownloadLink = document.getElementById('finalize-download-link');
  const finalizeRebuildLink = document.getElementById('finalize-rebuild-link');

  const toggleInlineWorkerBtn = document.getElementById('toggle-inline-worker');
  const inlineWorkerForm = document.getElementById('inline-worker-form');
  const inlineWorkerNameInput = document.getElementById('inline-worker-name');
  const inlineWorkerPhoneInput = document.getElementById('inline-worker-phone');
  const inlineAddWorkerBtn = document.getElementById('inline-add-worker-btn');

  const autoFillWarnings = document.getElementById('auto-fill-warnings');
  const shiftSelector = document.getElementById('shift-selector');
  const aiFillBtn = document.getElementById('ai-fill-btn');
  let lastParsedShifts = null;

  const backupDownloadLink = document.getElementById('backup-download-link');
  const backupRestoreLink = document.getElementById('backup-restore-link');
  const backupFileInput = document.getElementById('backup-file-input');
  const resetAppDataBtn = document.getElementById('reset-app-data-btn');

  const workersLoadCloudBtn = document.getElementById('workers-load-cloud-btn');
  const workersSaveCloudBtn = document.getElementById('workers-save-cloud-btn');
  const seedTestDataBtn = document.getElementById('seed-test-data-btn');

  /* ---- Collapses ---- */
  function setAddJobOpen(isOpen) {
    if (!addJobToggle) return;
    const fullBody = document.getElementById('add-job-full-body');
    addJobToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (fullBody) fullBody.style.display = isOpen ? 'block' : 'none';
    const caret = addJobToggle.querySelector('.caret');
    if (caret) caret.textContent = isOpen ? '▾' : '▸';
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

  function setWorkersOpen(isOpen) {
    if (!workersToggle || !workersBody) return;
    workersToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    workersBody.style.display = isOpen ? 'block' : 'none';
    const caret = workersToggle.querySelector('.caret');
    if (caret) caret.textContent = isOpen ? '▾' : '▸';
    if (workersList) workersList.style.display = isOpen ? 'block' : 'none';
  }

  if (workersToggle) {
    workersToggle.addEventListener('click', () => {
      const open = workersToggle.getAttribute('aria-expanded') === 'true';
      setWorkersOpen(!open);
    });
    workersToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const open = workersToggle.getAttribute('aria-expanded') === 'true';
        setWorkersOpen(!open);
      }
    });
    setWorkersOpen(false);
  }

  function setUpcomingOpen(isOpen) {
    if (!upcomingToggle || !upcomingBody) return;
    upcomingToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    upcomingBody.style.display = isOpen ? 'block' : 'none';
    const caret = upcomingToggle.querySelector('.caret');
    if (caret) caret.textContent = isOpen ? '▾' : '▸';
  }

  if (upcomingToggle) {
    upcomingToggle.addEventListener('click', () => {
      const open = upcomingToggle.getAttribute('aria-expanded') === 'true';
      setUpcomingOpen(!open);
    });
    upcomingToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const open = upcomingToggle.getAttribute('aria-expanded') === 'true';
        setUpcomingOpen(!open);
      }
    });
    setUpcomingOpen(false);
  }

  function applyShiftToForm(shift) {
    if (!shift) return;

    const startInput = document.getElementById('job-start');
    const endInput = document.getElementById('job-end');
    const phaseSelect = document.getElementById('job-phase');

    if (startInput && shift.startTime) startInput.value = shift.startTime;
    if (endInput && shift.endTime) endInput.value = shift.endTime;

    if (phaseSelect && shift.phase) {
      const phaseMap = { setup: 'Build', assist: 'Assist', strike: 'Dismantle' };
      const mapped = phaseMap[shift.phase] || '';
      if (mapped) phaseSelect.value = mapped;
    }
  }

  function setCompletedOpen(isOpen) {
    if (!completedToggle || !completedBody) return;
    completedToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    completedBody.style.display = isOpen ? 'block' : 'none';
    const caret = completedToggle.querySelector('.caret');
    if (caret) caret.textContent = isOpen ? '▾' : '▸';
  }

  if (completedToggle) {
    completedToggle.addEventListener('click', () => {
      const open = completedToggle.getAttribute('aria-expanded') === 'true';
      setCompletedOpen(!open);
    });
    completedToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const open = completedToggle.getAttribute('aria-expanded') === 'true';
        setCompletedOpen(!open);
      }
    });
    setCompletedOpen(false);
  }

  function setFinalizeOpen(isOpen) {
    if (!finalizeToggle || !finalizeBody) return;
    finalizeToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    finalizeBody.style.display = isOpen ? 'block' : 'none';
    const caret = finalizeToggle.querySelector('.caret');
    if (caret) caret.textContent = isOpen ? '▾' : '▸';
  }

  if (finalizeToggle) {
    finalizeToggle.addEventListener('click', () => {
      const open = finalizeToggle.getAttribute('aria-expanded') === 'true';
      setFinalizeOpen(!open);
    });
    finalizeToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const open = finalizeToggle.getAttribute('aria-expanded') === 'true';
        setFinalizeOpen(!open);
      }
    });
    setFinalizeOpen(false);
  }

  if (upcomingSeeAllBtn && upcomingJobsFull) {
    upcomingSeeAllBtn.addEventListener('click', () => {
      const isOpen = upcomingJobsFull.style.display !== 'none';
      const nowOpen = !isOpen;
      upcomingJobsFull.style.display = nowOpen ? 'block' : 'none';
      upcomingSeeAllBtn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      const caret = upcomingSeeAllBtn.querySelector('.caret');
      if (caret) caret.textContent = nowOpen ? '▾' : '▸';
    });
  }

  /* ---- Inline "Add new worker" inside Add Job ---- */
  if (toggleInlineWorkerBtn && inlineWorkerForm) {
    toggleInlineWorkerBtn.addEventListener('click', () => {
      const isHidden =
        inlineWorkerForm.style.display === 'none' ||
        !inlineWorkerForm.style.display;
      inlineWorkerForm.style.display = isHidden ? 'block' : 'none';
    });
  }

  if (inlineAddWorkerBtn && inlineWorkerNameInput && inlineWorkerPhoneInput) {
    inlineAddWorkerBtn.addEventListener('click', () => {
      const previouslySelected = getSelectedAssignWorkerIds();

      const name = inlineWorkerNameInput.value.trim();
      const phone = inlineWorkerPhoneInput.value.trim();
      if (!name) {
        alert('Enter a worker name.');
        return;
      }
      const newWorker = { id: generateId('w'), name, phone };
      data.workers.push(newWorker);
      saveData(data);
      inlineWorkerNameInput.value = '';
      inlineWorkerPhoneInput.value = '';
      rerenderAll();

      upsertWorkerToSupabase(newWorker);

      setTimeout(() => {
        restoreAssignWorkerSelection([...previouslySelected, newWorker.id]);
      }, 0);

      inlineWorkerForm.style.display = 'none';
    });
  }

  // Dev-only seeding helper: quickly add workers/jobs and trigger existing sync flows.
  async function handleSeedTestDataClick() {
    const seedWorkers = [
      { name: 'Test Worker A', phone: '+17025550111' },
      { name: 'Test Worker B', phone: '+17025550112' },
      { name: 'Test Worker C', phone: '+17025550113' }
    ];

    const existingNames = new Set(
      (data.workers || []).map((w) => (w.name || '').toLowerCase())
    );
    const existingPhones = new Set(
      (data.workers || [])
        .map((w) => (w.phone || '').trim())
        .filter(Boolean)
    );

    const newlyAddedWorkers = [];
    seedWorkers.forEach((seed) => {
      const nameLower = (seed.name || '').toLowerCase();
      const phoneTrim = (seed.phone || '').trim();
      const alreadyExists =
        existingNames.has(nameLower) || (phoneTrim && existingPhones.has(phoneTrim));
      if (alreadyExists) return;

      const worker = { id: generateId('w'), name: seed.name, phone: seed.phone };
      data.workers.push(worker);
      newlyAddedWorkers.push(worker);
    });

    if (newlyAddedWorkers.length) {
      saveData(data);
      rerenderAll();
      newlyAddedWorkers.forEach((w) => upsertWorkerToSupabase(w));
    }

    const workerIdsForAssign = (data.workers || [])
      .filter((w) => seedWorkers.some((s) => s.name === w.name || s.phone === w.phone))
      .map((w) => w.id)
      .slice(0, 3);

    const seedJobs = [
      {
        name: 'Seed Job – CES Install',
        date: new Date().toISOString().slice(0, 10),
        startTime: '09:00',
        endTime: '17:00',
        booth: '1000',
        location: 'LVCC – Central Hall',
        phase: 'Build',
        notes: 'Seed demo job for testing Supabase sync.',
        assignments: workerIdsForAssign.map((id) => ({ workerId: id, status: 'Invited' }))
      }
    ];

    seedJobs.forEach((seedJob) => {
      const already = (data.jobs || []).some(
        (j) => (j.name || '').toLowerCase() === seedJob.name.toLowerCase()
      );
      if (already) return;

      const job = createJobFromFields({
        ...seedJob,
        reportCompleted: false
      });

      if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
        syncJobToSupabaseClient(job);
      }    });

    console.log('[Seed] Demo workers/jobs created for testing.');
  }

  if (seedTestDataBtn) {
    seedTestDataBtn.addEventListener('click', handleSeedTestDataClick);
  }

  async function sendSmsInvitesForJob(job) {
    const workersWithPhones = getAssignments(job)
      .map((a) => data.workers.find((w) => w.id === a.workerId))
      .filter((w) => w && w.phone);

    if (!workersWithPhones.length) {
      console.warn('No workers with phone numbers for job', job?.id);
      return { failures: 0, sent: 0, skipped: true };
    }

    const base = getBaseWorkerUrl();
    let failures = 0;

    for (const w of workersWithPhones) {
      const workerLink = `${base}?workerId=${encodeURIComponent(w.id)}`;

      const msg = `CrewTech: ${
        job.name || 'Job'
      } on ${job.date || ''} ${job.startTime || ''}-${
        job.endTime || ''
      }. View details & confirm: ${workerLink}`;

      try {
        const res = await fetch('/.netlify/functions/sendSMS', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: w.name,
            phone: w.phone,
            message: msg
          })
        });

        if (!res.ok) {
          console.error('SMS failed for', w.name, await res.text());
          failures++;
        }
      } catch (err) {
        console.error('SMS error for', w.name, err);
        failures++;
      }
    }

    return { failures, sent: workersWithPhones.length, skipped: false };
  }

  function upsertWorkerToSupabase(worker) {
    console.log('[Supabase worker upsert] sending worker to Supabase', worker);
    try {
      fetch('/.netlify/functions/upsertWorkerToSupabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker })
      })
        .then((res) => {
          if (!res.ok) {
            console.error(
              '[Supabase worker upsert] failed',
              res.status,
              res.statusText
            );
          }
          return res.text().catch(() => '');
        })
        .then((bodyText) => {
          if (bodyText) {
            console.log('[Supabase worker upsert] response body', bodyText);
          }
          console.log('[Supabase worker upsert] success');
        })
        .catch((err) => {
          console.error('[Supabase worker upsert] failed', err);
        });
    } catch (err) {
      console.error('[Supabase worker upsert] failed', err);
    }
  }

  async function syncJobToSupabaseClient(job) {
    try {
      // Sync strip: online/offline hedge
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: true });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (window.__crewtechSync) window.__crewtechSync.pendingWrites = (window.__crewtechSync.pendingWrites || 0) + 1;
        if (typeof setSyncStrip === 'function') setSyncStrip({ online: false, syncing: false, pendingWrites: window.__crewtechSync ? window.__crewtechSync.pendingWrites : 1 });
        return;
      }

      console.log('[syncJobToSupabaseClient] sending job to Supabase', job);
      const res = await fetch('/.netlify/functions/syncJobToSupabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        job: {
          id: job.id,
          name: job.name,
          date: job.date,
          startTime: job.startTime,
          endTime: job.endTime,
          booth: job.booth,
          location: job.location,
          phase: job.phase,
          notes: job.notes,
          rawText: job.rawText,
          assignments: (job.assignments || job.worker_assignments || []),
          reportCompleted: job.reportCompleted,
          finalizedNotes: job.finalizedNotes,
          finalizedWorkLog: job.finalizedWorkLog
        }
      })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        console.warn('[Supabase sync] job upsert failed', json);
        if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
      } else {
        console.log('[Supabase sync] job upsert success', json.row || json);
        try { if (window.__crewtechSync) window.__crewtechSync.pendingWrites = 0; } catch(e) {}
        if (typeof setSyncStrip === 'function') setSyncStrip({ online: true, syncing: false, pendingWrites: 0, lastSyncAt: new Date().toISOString() });
      }
    } catch (err) {
      console.warn('[Supabase sync] job upsert error', err);
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
    }
  }

  window.syncJobToSupabaseClient = syncJobToSupabaseClient;

  async function deleteJobFromSupabaseClient(jobId) {
    // Sync strip: online/offline hedge
    if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: true });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (window.__crewtechSync) window.__crewtechSync.pendingWrites = (window.__crewtechSync.pendingWrites || 0) + 1;
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: false, syncing: false, pendingWrites: window.__crewtechSync ? window.__crewtechSync.pendingWrites : 1 });
      return false;
    }

    try {
      const res = await fetch('/.netlify/functions/deleteJobFromSupabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        console.warn('[Supabase sync] job delete failed', json);
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
        return false;
      }
      console.log('[Supabase sync] job delete success', json);
      try { if (window.__crewtechSync) window.__crewtechSync.pendingWrites = 0; } catch(e) {}
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: true, syncing: false, pendingWrites: 0, lastSyncAt: new Date().toISOString() });
      return true;
    } catch (err) {
      console.warn('[Supabase sync] job delete error', err);
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
      return false;
    }
  }

  window.deleteJobFromSupabaseClient = deleteJobFromSupabaseClient;



  async function refreshWorkersFromSupabase() {
    if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: true });

    try {
      const res = await fetch('/.netlify/functions/getWorkersFromSupabase');
      if (!res.ok) {
        console.warn('Supabase workers fetch failed with status', res.status);
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
        return;
      }

      const payload = await res.json();
      const rows = (payload && Array.isArray(payload.workers)) ? payload.workers : [];

      // Supabase is the source of truth: if it returns 0 rows, we clear local.
      data.workers = rows.map((w) => ({
        id: w.id,
        name: w.name || '',
        phone: w.phone || ''
      }));

      saveData(data);
      rerenderAll();
      console.log(`Supabase workers loaded: ${data.workers.length}`);
    } catch (err) {
      console.error('Error refreshing workers from Supabase:', err);
    }
  }

  async function refreshJobsFromSupabase() {
    if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: true });

    try {
      const res = await fetch("/.netlify/functions/getJobsFromSupabase");
      if (!res.ok) {
        console.warn("Supabase jobs fetch failed with status", res.status);
      if (typeof setSyncStrip === 'function') setSyncStrip({ online: navigator.onLine, syncing: false });
        return;
      }

      const payload = await res.json();
      const rows = (payload && Array.isArray(payload.jobs)) ? payload.jobs : [];

      // Supabase is the source of truth: if it returns 0 rows, we clear local.
      data.jobs = rows.map((j) => ({
        id: j.id,
        name: j.name || "",
        jobName: j.jobName ?? null,
        jobNameMinimal: j.jobNameMinimal ?? null,
        date: j.date || "",
        startTime: j.startTime || "",
        endTime: j.endTime || "",
        booth: j.booth || "",
        boothNumber: j.boothNumber ?? null,
        location: j.location || "",
        phase: j.phase || "",
        jobPhase: j.jobPhase ?? null,
        notes: j.notes || "",
        rawText: j.rawText || "",
        assignments: j.assignments ?? null,
        finalizedWorkLog: j.finalizedWorkLog ?? null,
        finalizedNotes: j.finalizedNotes ?? null,
        reportCompleted: j.reportCompleted ?? false,
        createdAt: j.createdAt ?? null,
        updatedAt: j.updatedAt ?? null
      }));

      saveData(data);
      rerenderAll();
      console.log(`Supabase jobs loaded: ${data.jobs.length}`);
    } catch (err) {
      console.error("Error refreshing jobs from Supabase:", err);
    }
  }


  if (shiftSelector) {
    shiftSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.shift-pill');
      if (!btn || !lastParsedShifts) return;

      const key = btn.getAttribute('data-shift-key');
      if (!key) return;

      const shift = lastParsedShifts.find((s) => s.type === key);
      if (!shift) return;

      shiftSelector.querySelectorAll('.shift-pill').forEach((b) =>
        b.classList.remove('shift-pill-active')
      );
      btn.classList.add('shift-pill-active');

      applyShiftToForm(shift);
    });
  }

  /* ---- Auto-Fill Job ---- */

  if (aiFillBtn) {
    aiFillBtn.addEventListener('click', async () => {
      // AI parser: calls Netlify function /.netlify/functions/parseWithAI (currently stubbed).
      const rawTextArea = document.getElementById('raw-text');
      const raw = rawTextArea ? rawTextArea.value.trim() : '';

      if (!raw) {
        alert('Please paste some text first.');
        return;
      }

      aiFillBtn.disabled = true;
      const originalLabel = aiFillBtn.textContent;
      aiFillBtn.textContent = 'AI thinking…';

      try {
        const res = await fetch('/.netlify/functions/parseWithAI', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: raw })
        });

        console.log('parseWithAI status:', res.status);
        const rawResponseText = await res.text();
        console.log('parseWithAI raw response:', rawResponseText);

        let data;
        try {
          data = JSON.parse(rawResponseText);
        } catch (err) {
          console.error('JSON parse error:', err);
          alert('AI response was not valid JSON. Raw text:\n' + rawResponseText);
          return;
        }

        const hasLegacyShape = data && data.ok === true && Array.isArray(data.shifts);
        const hasSimpleShape =
          data &&
          (data.jobName ||
            data.date ||
            data.startTime ||
            data.endTime ||
            data.location ||
            data.jobPhase ||
            data.boothNumber);

        if (!hasLegacyShape && !hasSimpleShape) {
          alert('AI error: ' + (data.message || data.error || 'Unexpected response format'));
          return;
        }

        if (hasLegacyShape) {
          if (!Array.isArray(data.shifts) || !data.shifts.length) {
            return;
          }

          console.log('Parsed shifts:', data.shifts);
          const idx =
            Number.isInteger(data.primaryShiftIndex) &&
            data.primaryShiftIndex >= 0 &&
            data.primaryShiftIndex < data.shifts.length
              ? data.primaryShiftIndex
              : 0;
          const s = data.shifts[idx] || data.shifts[0];

          if (s.jobName) document.getElementById('job-name').value = s.jobName;
          if (s.date) document.getElementById('job-date').value = s.date;
          if (s.startTime) document.getElementById('job-start').value = s.startTime;
          if (s.endTime) document.getElementById('job-end').value = s.endTime;
          if (s.booth) document.getElementById('job-booth').value = s.booth;
          if (s.hall) document.getElementById('job-location').value = s.hall;
          if (data.boothNumber) {
            const boothInput = document.getElementById('job-booth');
            if (boothInput) boothInput.value = data.boothNumber;
          }

          if (s.numWorkers !== null && s.numWorkers !== undefined) {
            const notesEl = document.getElementById('job-notes');
            if (notesEl && !notesEl.value.trim()) {
              notesEl.value = `Need ${s.numWorkers} workers.`;
            }
          }

        if (s.phase) {
          const phaseLower = String(s.phase).toLowerCase();
          const phaseMap = {
            setup: 'Build',
            show: 'Assist',
            strike: 'Dismantle',
            assist: 'Assist',
            other: ''
          };
          const mapped = phaseMap[phaseLower] || '';
          if (mapped) {
            const phaseSelect = document.getElementById('job-phase');
            if (phaseSelect) phaseSelect.value = mapped;
          }
        }

        if (data.jobPhase) {
          const phaseLower = String(data.jobPhase).toLowerCase();
          const phaseMap = {
            install: 'Build',
            show: 'Assist',
            teardown: 'Dismantle',
            other: 'Other'
          };
          const mapped = phaseMap[phaseLower] || '';
          if (mapped) {
            const phaseSelect = document.getElementById('job-phase');
            if (phaseSelect) phaseSelect.value = mapped;
          }
        }

          if (autoFillWarnings && Array.isArray(data.warnings) && data.warnings.length) {
            autoFillWarnings.innerHTML =
              '<strong>AI notes:</strong> ' + data.warnings.join(' · ');
          }
        } else if (hasSimpleShape) {
          if (data.jobName) document.getElementById('job-name').value = data.jobName;
          if (data.date) document.getElementById('job-date').value = data.date;
          if (data.startTime) document.getElementById('job-start').value = data.startTime;
          if (data.endTime) document.getElementById('job-end').value = data.endTime;
          if (data.location) document.getElementById('job-location').value = data.location;
          if (data.boothNumber) {
            const boothInput = document.getElementById('job-booth');
            if (boothInput) boothInput.value = data.boothNumber;
          }

          if (data.workerCount !== null && data.workerCount !== undefined) {
            const notesEl = document.getElementById('job-notes');
            if (notesEl && !notesEl.value.trim()) {
              notesEl.value = `Need ${data.workerCount} workers.`;
            }
          }

          if (data.jobPhase) {
            const phaseLower = String(data.jobPhase).toLowerCase();
            const phaseMap = {
              install: 'Build',
              show: 'Assist',
              teardown: 'Dismantle',
              other: 'Other'
            };
            const mapped = phaseMap[phaseLower] || '';
            if (mapped) {
              const phaseSelect = document.getElementById('job-phase');
              if (phaseSelect) phaseSelect.value = mapped;
            }
          }
        }

      } catch (err) {
        console.error('Error calling parseWithAI:', err);
        alert('AI error: ' + (err?.message || err));
      } finally {
        aiFillBtn.disabled = false;
        aiFillBtn.textContent = originalLabel;
      }
    });
  }

  /* ---- Add Job Parser UI (simple card) ---- */
  const jobTextInput = document.getElementById('jobTextInput');
  const parseJobButton = document.getElementById('parseJobButton');

  if (jobTextInput && parseJobButton) {
    parseJobButton.addEventListener('click', async () => {
      const rawText = jobTextInput.value.trim();
      if (!rawText) {
        alert('Paste some job text first.');
        return;
      }

      parseJobButton.disabled = true;
      parseJobButton.textContent = 'Parsing...';

      try {
        const res = await fetch('/.netlify/functions/parseWithAI', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawText })
        });

        if (!res.ok) {
          throw new Error('Server error: ' + res.status);
        }

        const data = await res.json();
        console.log('Parsed job data:', data);

        const nameEl = document.getElementById('jobNameInput');
        const dateEl = document.getElementById('jobDateInput');
        const startEl = document.getElementById('jobStartInput');
        const endEl = document.getElementById('jobEndInput');
        const locationEl = document.getElementById('jobLocationInput');
        const workersEl = document.getElementById('jobWorkersInput');

        if (nameEl) nameEl.value = data.jobName || '';
        if (dateEl) dateEl.value = data.date || '';
        if (startEl) startEl.value = data.startTime || '';
        if (endEl) endEl.value = data.endTime || '';
        if (locationEl) locationEl.value = data.location || '';
        if (workersEl) workersEl.value = data.workerCount || '';
      } catch (err) {
        console.error(err);
        alert('Error parsing job. Check console.');
      } finally {
        parseJobButton.disabled = false;
        parseJobButton.textContent = 'Parse Job with AI';
      }
    });
  }

  /* ---- Backup buttons ---- */
  if (backupDownloadLink) {
    backupDownloadLink.addEventListener('click', () =>
      exportBackupJson(data)
    );
  }

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

  /* ---- Workers cloud buttons (optional) ---- */
  if (workersSaveCloudBtn) {
    workersSaveCloudBtn.addEventListener('click', () =>
      saveWorkersToCloud(data.workers)
    );
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

  /* ---- Reset app data (dev only) ---- */
  // Dev-only: clears local data AND Supabase jobs/workers via clearAllData function.
  // Do not expose this in worker.html.
  if (resetAppDataBtn) {
    resetAppDataBtn.addEventListener('click', async () => {
      const confirmed = confirm('This will delete ALL jobs and ALL workers. Continue?');
      if (!confirmed) return;
      data.jobs = [];
      data.workers = [];
      saveData(data);
      rerenderAll();
      alert('All data cleared.');

      try {
        console.log('[Dev clear] calling Supabase clearAllData...');
        const res = await fetch('/.netlify/functions/clearAllData', {
          method: 'POST'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          console.warn('[Dev clear] Supabase clear failed', json);
        } else {
          console.log('[Dev clear] Supabase tables cleared');
        }
      } catch (err) {
        console.warn('[Dev clear] Supabase clear error', err);
      }
    });
  }

  /* ---- Reset / Export CSV (optional) ---- */
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

  /* ---- Add worker (Workers card) ---- */
  if (addWorkerBtn) {
    addWorkerBtn.addEventListener('click', () => {
      const previouslySelected = getSelectedAssignWorkerIds();

      const nameInput = document.getElementById('worker-name');
      const phoneInput = document.getElementById('worker-phone');
      const name = nameInput.value.trim();
      const phone = phoneInput.value.trim();

      if (!name) {
        alert('Enter a worker name.');
        return;
      }

      const newWorker = { id: generateId('w'), name, phone };
      data.workers.push(newWorker);
      saveData(data);
      nameInput.value = '';
      phoneInput.value = '';
      rerenderAll();

      upsertWorkerToSupabase(newWorker);

      setTimeout(() => {
        restoreAssignWorkerSelection([...previouslySelected, newWorker.id]);
      }, 0);

      if (workersList) workersList.style.display = 'block';
      setWorkersOpen(true);
    });
  }

  function createJobFromFields(fields) {
    const assignmentStatus = fields.defaultAssignmentStatus || 'Invited';
    const normalizedAssignments = Array.isArray(fields.assignments)
      ? fields.assignments
          .filter((a) => a && a.workerId)
          .map((a) => ({
            workerId: a.workerId,
            status: a.status || assignmentStatus
          }))
      : [];

    if (!normalizedAssignments.length && Array.isArray(fields.assignedWorkerIds)) {
      fields.assignedWorkerIds.forEach((id) => {
        if (id) normalizedAssignments.push({ workerId: id, status: assignmentStatus });
      });
    }

    const job = {
      id: generateId('j'),
      name: fields.name || '',
      date: fields.date || '',
      startTime: fields.startTime || '',
      endTime: fields.endTime || '',
      booth: fields.booth || '',
      location: fields.location || '',
      notes: fields.notes || '',
      rawText: fields.rawText || '',
      phase: fields.phase || '',
      assignments: normalizedAssignments,
      assignedWorkerIds: normalizedAssignments.map((a) => a.workerId),
      reportCompleted: !!fields.reportCompleted
    };

    getAssignments(job);
    data.jobs.push(job);
    rerenderAll();

    return job;
  }

  function ensureSampleWorkers(minCount = 10) {
    if (!Array.isArray(data.workers)) data.workers = [];
    if (data.workers.length >= minCount) return;

    const sampleWorkers = [
      { name: 'Stevey Hale', phone: '702-555-1842' },
      { name: 'Carlos Mendez', phone: '702-555-9021' },
      { name: 'Pat Mani', phone: '702-555-7740' },
      { name: 'Kevin Duval', phone: '702-555-6614' },
      { name: 'Marcus "Mo" Santiago', phone: '702-555-4388' },
      { name: 'Jenna Park', phone: '702-555-2297' },
      { name: 'Robby Krane', phone: '702-555-1446' },
      { name: 'Talia Ruiz', phone: '702-555-3182' },
      { name: 'Derek Foster', phone: '702-555-9675' },
      { name: 'Leah Nakamura', phone: '702-555-5823' }
    ];

    const existingNames = new Set(data.workers.map((w) => (w.name || '').toLowerCase()));

    for (const worker of sampleWorkers) {
      if (data.workers.length >= minCount) break;
      if (existingNames.has(worker.name.toLowerCase())) continue;

      const newWorker = {
        id: generateId('w'),
        name: worker.name,
        phone: worker.phone
      };
      data.workers.push(newWorker);
      existingNames.add(worker.name.toLowerCase());
    }

    saveData(data);
  }

  async function generateSampleJobs(count = 20) {
    ensureSampleWorkers();
    const workersAvailable = Array.isArray(data.workers) ? data.workers : [];

    workersAvailable.forEach((w) => {
      try {
        upsertWorkerToSupabase(w);
        console.log('[Sample seed] worker upsert queued', w.id, w.name);
      } catch (err) {
        console.error('[Sample seed] worker upsert error', err);
      }
    });

    const sampleShows = ['CES', 'SEMA', 'NAB', 'MAGIC', 'AWS', 'AAPEX'];
    const sampleClients = [
      'NovaSignal',
      'AeroFlow',
      'ExoMedia',
      'CloudCore',
      'IonFlex',
      'ThreadShack',
      'UrbanRise',
      'BioWave'
    ];
    const sampleLocations = [
      'LVCC - Central Hall',
      'LVCC - West Hall',
      'LVCC - South Hall',
      'Venetian Expo - Hall D',
      'Venetian Expo - Level 2'
    ];
    const samplePhases = ['Build', 'Assist', 'Dismantle', 'Other'];
    const sampleBooths = ['W-3142', 'C41082', 'N2317', 'D-2049', 'A3127', 'B1201'];
    const sampleNotes = [
      'Client rep arriving 30 min early.',
      'Park in silver lot; pass at will call.',
      'Black shirts, no logos. Check in at door 3.',
      'Union rules apply; bring gloves.',
      'AV handoff with client PM at start.',
      'Keep booth clear for freight by end of day.'
    ];

    const statusPool = ['Confirmed', 'Invited', 'Invited', 'Confirmed', 'Declined'];

    function pickRandom(arr) {
      if (!arr.length) return '';
      return arr[Math.floor(Math.random() * arr.length)];
    }

    function padTime(num) {
      return String(num).padStart(2, '0');
    }

    function randomDateWithin(daysForward) {
      const d = new Date();
      const offset = Math.floor(Math.random() * (daysForward + 1));
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    }

    function randomTimeRange(dateIso) {
      const startHour = 7 + Math.floor(Math.random() * 7); // 7-13
      const startMinute = Math.random() < 0.5 ? 0 : 30;
      const startTime = `${padTime(startHour)}:${padTime(startMinute)}`;
      const startDate = new Date(`${dateIso}T${startTime}:00`);
      const durationHours = 6 + Math.floor(Math.random() * 4); // 6-9 hours
      const endDate = new Date(startDate);
      endDate.setHours(endDate.getHours() + durationHours);
      const endTime = `${padTime(endDate.getHours())}:${padTime(
        endDate.getMinutes()
      )}`;
      return { startTime, endTime };
    }

    for (let i = 0; i < count; i++) {
      const show = pickRandom(sampleShows);
      const client = pickRandom(sampleClients);
      const phase = pickRandom(samplePhases);
      const location = pickRandom(sampleLocations);
      const booth = pickRandom(sampleBooths);
      const notes = pickRandom(sampleNotes);
      const date = randomDateWithin(45);
      const { startTime, endTime } = randomTimeRange(date);

      const phaseLabel = phase === 'Build' ? 'Install' : phase;
      const jobName = `${client} - ${show} - ${phaseLabel}`;

      let assignments = [];
      if (workersAvailable.length) {
        const maxWorkers = Math.min(4, workersAvailable.length);
        const minWorkers = Math.min(2, maxWorkers);
        const countWorkers =
          maxWorkers === 0
            ? 0
            : Math.floor(Math.random() * (maxWorkers - minWorkers + 1)) + minWorkers;
        const shuffledIds = workersAvailable
          .map((w) => w.id)
          .sort(() => Math.random() - 0.5);
        assignments = shuffledIds.slice(0, countWorkers).map((id) => ({
          workerId: id,
          status: pickRandom(statusPool)
        }));
      }

      const job = createJobFromFields({
        name: jobName,
        date,
        startTime,
        endTime,
        booth,
        location,
        phase,
        notes,
        assignments,
        rawText: '',
        reportCompleted: false
      });

      console.log('[Generate sample jobs] created job', job);
      try {
        await syncJobToSupabaseClient(job);
        console.log('[Sample seed] job sync success', jobName);
      } catch (err) {
        console.warn('[Sample seed] job sync error', err);
      }
    }
    console.log('[Generate sample jobs] finished syncing all sample jobs to Supabase');
  }

  function generateFinalizableJobs() {
    ensureSampleWorkers();

    const statusPool = ['Confirmed', 'Invited', 'Invited', 'Confirmed', 'Declined'];
    const workersAvailable = Array.isArray(data.workers) ? data.workers : [];

    const templates = [
      {
        name: 'AeroFlow Dynamics - SEMA Install',
        date: '2025-11-26',
        startTime: '07:30',
        endTime: '16:45',
        booth: 'C41082',
        location: 'LVCC - Central Hall',
        phase: 'Build',
        notes:
          'Need 6 laborers (crating, assemble 20x20, place demo cars). Meet Michelle at freight by 7:15.',
        rawText: `Show: SEMA 2025
Client: AeroFlow Dynamics
Booth: C41082 - Central Hall
Install date: Nov 26, 2025
Call time: 7:30 AM
Estimated wrap: 4:45 PM
Need 6 laborers (crating, assemble 20x20, place demo cars).
Venue: Las Vegas Convention Center - Central Hall
Notes: Client contact is Michelle D., wants crew at freight by 7:15.`
      },
      {
        name: 'CloudCore Systems - AWS re:Invent',
        date: '2025-11-26',
        startTime: '13:05',
        endTime: '18:30',
        booth: 'D-2049',
        location: 'Venetian Expo - Hall D',
        phase: 'Build',
        notes:
          '4 techs for workstation setup + signage. Meet Mila at dock security 20 min before call.',
        rawText: `Event: AWS re:Invent
Exhibitor: CloudCore Systems
Booth: D-2049 - Venetian Expo Hall D
Install: Wed Nov 26
Crew call: 1:05 PM
Projected finish: ~6:30 PM
Need 4 techs for workstation setup + signage.
Venue: Venetian Expo - Hall D
Notes: Meet Mila at dock security 20 min before call.`
      },
      {
        name: 'ThreadShack - MAGIC Move-in',
        date: '2025-11-27',
        startTime: '09:10',
        endTime: '15:20',
        booth: '11219',
        location: 'LVCC - South Hall',
        phase: 'Build',
        notes:
          '3 laborers (racks + backdrop + light assembly). Start may slide by 15 min with Jordan.',
        rawText: `Show: MAGIC Las Vegas
Client: ThreadShack Apparel
Booth: 11219 - South Hall
Move-in date: Nov 27
Call time: 9:10 AM
Estimated wrap: 3:20 PM
3 laborers (racks + backdrop + light assembly).
Venue: LVCC - South Hall
Notes: Jordan (rep) landing at 8:15, may slide start by 15 min.`
      },
      {
        name: 'NovaSignal Labs - CES Suite Prep',
        date: '2025-11-27',
        startTime: '14:00',
        endTime: '18:00',
        booth: '',
        location: 'Venetian Towers - Suite 28-112',
        phase: 'Build',
        notes:
          'Suite demo setup (stations + cable runs + monitor mounts). Check in at business center for key.',
        rawText: `Event: CES Prep Demo (private suite)
Client: NovaSignal Labs
Location: Venetian Towers - Suite 28-112
No booth (suite demo only)
Setup date: November 27, 2025
Call time: 2:00 PM
Estimated wrap: 6:00 PM
Need 3 laborers (demo stations + cable runs + monitor mounts).
Notes: Check in at Venetian business center for suite key.`
      },
      {
        name: 'IonFlex Mobility - AAPEX Install',
        date: '2025-11-26',
        startTime: '10:20',
        endTime: '15:55',
        booth: 'A3127',
        location: 'Venetian Expo - Level 2',
        phase: 'Build',
        notes:
          '7 techs for charging stations and cable routing. Text Evan 30 min before arrival.',
        rawText: `Show: AAPEX 2025
Exhibitor: IonFlex Mobility
Booth: A3127 - Sands / Venetian Expo Level 2
Install day: Nov 26
Crew call: 10:20 AM
Projected finish: ~3:55 PM
7 techs for charging stations and cable routing.
Notes: Evan (client) prefers text update 30 min before arrival.`
      }
    ];

    function pickRandom(arr) {
      if (!arr.length) return '';
      return arr[Math.floor(Math.random() * arr.length)];
    }

    templates.forEach((tpl) => {
      let assignments = [];
      if (workersAvailable.length) {
        const maxWorkers = Math.min(5, workersAvailable.length);
        const minWorkers = Math.min(2, maxWorkers);
        const countWorkers =
          maxWorkers === 0
            ? 0
            : Math.floor(Math.random() * (maxWorkers - minWorkers + 1)) + minWorkers;
        const shuffledIds = workersAvailable
          .map((w) => w.id)
          .sort(() => Math.random() - 0.5);
        assignments = shuffledIds.slice(0, countWorkers).map((id) => ({
          workerId: id,
          status: pickRandom(statusPool)
        }));
      }

      createJobFromFields({
        name: tpl.name,
        date: tpl.date,
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        booth: tpl.booth,
        location: tpl.location,
        phase: tpl.phase,
        notes: tpl.notes,
        assignments,
        rawText: tpl.rawText,
        reportCompleted: false
      });
    });
  }

  /* ---- Add job + send invites ---- */
  if (addJobBtn) {
    addJobBtn.addEventListener('click', async () => {
      const name = document.getElementById('job-name').value.trim();
      const date = document.getElementById('job-date').value;
      const startTime = document.getElementById('job-start').value;
      const endTime = document.getElementById('job-end').value;
      const booth = document.getElementById('job-booth').value.trim();
      const location = document.getElementById('job-location').value.trim();
      const notes = document.getElementById('job-notes').value.trim();
      const rawText = document.getElementById('raw-text').value.trim();
      const phase = document.getElementById('job-phase').value;

      if (!name || !date || !startTime || !endTime || !location) {
        alert('Please enter job name, date, start/end times, and location.');
        return;
      }

      const selectedWorkerIds = Array.from(
        document.querySelectorAll(
          '#assign-workers input[type="checkbox"]:checked'
        )
      ).map((cb) => cb.value);

      if (!selectedWorkerIds.length) {
        alert('Select at least one worker to invite.');
        return;
      }

      if (
        !confirm('Create job and open SMS Queue to send invites?')
      ) {
        return;
      }

      const assignments = selectedWorkerIds.map((id) => ({
        workerId: id,
        status: 'Invited'
      }));

      const job = createJobFromFields({
        name,
        date,
        startTime,
        endTime,
        booth,
        location,
        notes,
        rawText,
        phase,
        assignments,
        reportCompleted: false
      });

      const queue = buildSmsQueueForJob(job, data);

      // Always show the modal (it will display “no workers with phone numbers” if empty)
      showSmsQueueModal(job, queue);

      // For the existing alerts below (minimal change):
      const smsResult = queue.length ? { skipped: false, failures: 0 } : { skipped: true };

      document.getElementById('job-name').value = '';
      document.getElementById('job-date').value = '';
      document.getElementById('job-start').value = '';
      document.getElementById('job-end').value = '';
      document.getElementById('job-booth').value = '';
      document.getElementById('job-location').value = '';
      document.getElementById('job-notes').value = '';
      document.getElementById('raw-text').value = '';
      document.getElementById('job-phase').value = '';
      document
        .querySelectorAll('#assign-workers input[type="checkbox"]')
        .forEach((cb) => (cb.checked = false));

      if (smsResult?.skipped) {
        alert('Job created, but no worker phone numbers to text.');
      }

      if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
        syncJobToSupabaseClient(job);
      }
    });
  }

  /* ---- Generate sample jobs (dev) ---- */
  if (generateSampleJobsBtn) {
    generateSampleJobsBtn.addEventListener('click', () => {
      generateSampleJobs(20);
    });
  }

  if (generateFinalizableJobsBtn) {
    generateFinalizableJobsBtn.addEventListener('click', () => {
      generateFinalizableJobs();
    });
  }
  /* ---- Finalize Job helpers ---- */

  function buildFinalizeRowsForJob(job) {
    const assignments = getAssignments(job);
    return assignments.map((a) => {
      const worker = data.workers.find((w) => w.id === a.workerId);
      return {
        workerId: a.workerId,
        workerName: worker ? worker.name : '(missing worker)',
        scheduledStart: job.startTime || '',
        scheduledEnd: job.endTime || '',
        actualStart: job.startTime || '',
        actualEnd: job.endTime || '',
        totalHours: ''
      };
    });
  }

  function collectFinalizeRowsFromDom() {
    const rows = [];
    if (!finalizeWorkersContainer) return rows;

    const trList = finalizeWorkersContainer.querySelectorAll('tbody tr');
    trList.forEach((tr) => {
      const workerId = tr.getAttribute('data-worker-id') || '';
      const cells = tr.querySelectorAll('td');
      const nameCell = cells[0];
      const actualStartInput = tr.querySelector('input[data-field="actualStart"]');
      const actualEndInput = tr.querySelector('input[data-field="actualEnd"]');
      const totalHoursInput = tr.querySelector('input[data-field="totalHours"]');

      rows.push({
        workerId,
        workerName: nameCell ? nameCell.textContent.trim() : '',
        scheduledStart: tr.getAttribute('data-scheduled-start') || '',
        scheduledEnd: tr.getAttribute('data-scheduled-end') || '',
        actualStart: actualStartInput ? actualStartInput.value : '',
        actualEnd: actualEndInput ? actualEndInput.value : '',
        totalHours: totalHoursInput ? totalHoursInput.value : ''
      });
    });

    return rows;
  }

  function buildFinalizeReportText(job, rows) {
    const lines = [];
    lines.push(`Job: ${job.name || ''}`);
    if (job.date) lines.push(`Date: ${formatDate(job.date)}`);

    const timeBits = [];
    if (job.startTime) timeBits.push(formatTime(job.startTime));
    if (job.endTime) timeBits.push(formatTime(job.endTime));
    if (timeBits.length) lines.push(`Scheduled: ${timeBits.join(' – ')}`);

    const locBits = [];
    if (job.booth) locBits.push('Booth ' + job.booth);
    if (job.location) locBits.push(job.location);
    if (locBits.length) lines.push('Location: ' + locBits.join(' • '));

    if (job.phase) lines.push('Phase: ' + job.phase);
    lines.push('');
    lines.push('Workers:');
    lines.push('Name | Start | End | Total Hrs');
    lines.push('---- | ----- | --- | ---------');

    rows.forEach((r) => {
      lines.push(
        `${r.workerName || ''} | ${r.actualStart || ''} | ${
          r.actualEnd || ''
        } | ${r.totalHours || ''}`
      );
    });

    return lines.join('\n');
  }

  function renderFinalizeWorkersTable(job) {
    if (!finalizeWorkersContainer) return;

    const rows = buildFinalizeRowsForJob(job);
    if (!rows.length) {
      finalizeWorkersContainer.innerHTML =
        '<p class="muted">No workers assigned to this job yet.</p>';
      if (finalizeExportBtn) finalizeExportBtn.disabled = true;
      if (finalizeCompleteBtn) finalizeCompleteBtn.disabled = true;
      if (finalizeNotes) finalizeNotes.value = '';
      return;
    }

    let html =
      '<div class="scroll-x"><table class="table"><thead><tr>' +
      '<th>Worker</th><th>Start</th><th>End</th><th>Total hrs</th>' +
      '</tr></thead><tbody>';

    rows.forEach((row) => {
      html +=
        `<tr data-worker-id="${row.workerId}" data-scheduled-start="${row.scheduledStart}" data-scheduled-end="${row.scheduledEnd}">` +
        `<td>${row.workerName}</td>` +
        `<td><input type="time" class="finalize-input" data-field="actualStart" value="${row.actualStart}"></td>` +
        `<td><input type="time" class="finalize-input" data-field="actualEnd" value="${row.actualEnd}"></td>` +
        `<td><input type="number" class="finalize-input" data-field="totalHours" step="0.25" min="0" placeholder="0"></td>` +
        '</tr>';
    });

    html += '</tbody></table></div>';
    finalizeWorkersContainer.innerHTML = html;

    if (finalizeExportBtn) finalizeExportBtn.disabled = false;
    if (finalizeCompleteBtn) finalizeCompleteBtn.disabled = false;

    const inputs = finalizeWorkersContainer.querySelectorAll('.finalize-input');
    inputs.forEach((input) => {
      const field = input.dataset.field;
      if (field === 'actualStart' || field === 'actualEnd') {
        input.addEventListener('change', () => {
          const tr = input.closest('tr');
          if (!tr) return;

          const startInput = tr.querySelector('input[data-field="actualStart"]');
          const endInput = tr.querySelector('input[data-field="actualEnd"]');
          const totalInput = tr.querySelector('input[data-field="totalHours"]');
          if (!startInput || !endInput || !totalInput) return;

          const total = calcHours(startInput.value, endInput.value);
          if (total !== '') {
            totalInput.value = total;
          }
        });
      }
    });

    const renderedRows = finalizeWorkersContainer.querySelectorAll('tbody tr');
    renderedRows.forEach((tr) => {
      const startInput = tr.querySelector('input[data-field="actualStart"]');
      const endInput = tr.querySelector('input[data-field="actualEnd"]');
      const totalInput = tr.querySelector('input[data-field="totalHours"]');
      if (!startInput || !endInput || !totalInput) return;

      if (!totalInput.value) {
        const total = calcHours(startInput.value, endInput.value);
        if (total !== '') {
          totalInput.value = total;
        }
      }
    });

    const collected = collectFinalizeRowsFromDom();
    if (finalizeNotes) {
      finalizeNotes.value = buildFinalizeReportText(job, collected);
    }
  }

  /* ---- Finalize Job: dropdown change ---- */
  if (finalizeJobSelect && finalizeWorkersContainer && finalizeNotes) {
    finalizeJobSelect.addEventListener('change', () => {
      const jobId = finalizeJobSelect.value;
      if (!jobId) {
        finalizeWorkersContainer.innerHTML =
          '<p class="muted">Select a job above to see workers and hours.</p>';
        finalizeNotes.value = '';
        if (finalizeExportBtn) finalizeExportBtn.disabled = true;
        if (finalizeCompleteBtn) finalizeCompleteBtn.disabled = true;
        return;
      }

      const job = data.jobs.find((j) => j.id === jobId);
      if (!job) return;
      renderFinalizeWorkersTable(job);
    });
  }

  /* ---- Finalize Job: Copy report text (button) ---- */
  if (finalizeExportBtn && finalizeNotes) {
    finalizeExportBtn.addEventListener('click', async () => {
      const text = finalizeNotes.value.trim();
      if (!text) {
        alert('There is no report text to copy yet.');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        alert('Report copied to clipboard.');
      } catch (err) {
        console.error('Clipboard error:', err);
        finalizeNotes.focus();
        finalizeNotes.select();
        alert('Couldn’t auto-copy. Text is selected — press Ctrl/Cmd + C.');
      }
    });
  }

  /* ---- Finalize Job: Download CSV (link under textarea) ---- */
  if (finalizeDownloadLink && finalizeJobSelect) {
    finalizeDownloadLink.addEventListener('click', (e) => {
      e.preventDefault();

      const jobId = finalizeJobSelect.value;
      if (!jobId) {
        alert('Pick a job to finalize first.');
        return;
      }

      const job = data.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const rows = collectFinalizeRowsFromDom();
      if (!rows.length) {
        alert('No worker rows to export yet.');
        return;
      }

      const csvLines = [];
      csvLines.push(
        [
          'Job',
          'Date',
          'Booth',
          'Location',
          'Phase',
          'Worker',
          'Start',
          'End',
          'Total Hrs'
        ].join(',')
      );

      rows.forEach((r) => {
        const row = [
          job.name || '',
          job.date || '',
          job.booth || '',
          job.location || '',
          job.phase || '',
          r.workerName || '',
          r.actualStart || '',
          r.actualEnd || '',
          r.totalHours || ''
        ].map((v) => '"' + String(v).replace(/"/g, '""') + '"');
        csvLines.push(row.join(','));
      });

      const blob = new Blob([csvLines.join('\n')], {
        type: 'text/csv;charset=utf-8;'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'crewtech-final-report.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  }

  if (finalizeRebuildLink && finalizeJobSelect && finalizeNotes) {
    finalizeRebuildLink.addEventListener('click', () => {
      const jobId = finalizeJobSelect.value;
      if (!jobId) {
        alert('Pick a job to finalize first.');
        return;
      }

      const job = (data.jobs || []).find((j) => String(j.id) === String(jobId));
      if (!job) {
        console.warn('Finalize rebuild: no job found for id', jobId, data.jobs);
        alert('Could not find that job. Try refreshing the page.');
        return;
      }

      const rows = collectFinalizeRowsFromDom();
      const text = buildFinalizeReportText(job, rows);
      finalizeNotes.value = text;
    });
  }

  /* ---- Finalize Job: Complete & move to Completed ---- */
  if (
    finalizeCompleteBtn &&
    finalizeJobSelect &&
    finalizeWorkersContainer &&
    finalizeNotes
  ) {
    finalizeCompleteBtn.addEventListener('click', () => {
      const jobId = finalizeJobSelect.value;
      if (!jobId) {
        alert('Pick a job to finalize first.');
        return;
      }

      const job = (data.jobs || []).find((j) => String(j.id) === String(jobId));
      if (!job) {
        console.warn('Finalize: no job found for id', jobId, data.jobs);
        alert('Could not find that job. Try refreshing the page.');
        return;
      }

      if (
        !confirm(
          'Mark this job as report completed and move it to Completed Jobs?'
        )
      ) {
        return;
      }

      const finalizedRows = collectFinalizeRowsFromDom();
      job.finalizedWorkLog = finalizedRows;
      if (finalizeNotes) {
        job.finalizedNotes = finalizeNotes.value || '';
      }

      job.reportCompleted = true;
      saveData(data);
      rerenderAll();
      if (!["localhost","127.0.0.1"].includes(window.location.hostname)) {
        syncJobToSupabaseClient(job);
      }
      finalizeJobSelect.value = '';
      finalizeWorkersContainer.innerHTML =
        '<p class="muted">Job finalized. Pick another job to finalize.</p>';
      finalizeNotes.value = '';
      if (finalizeExportBtn) finalizeExportBtn.disabled = true;
      if (finalizeCompleteBtn) finalizeCompleteBtn.disabled = true;
    });
  }

  /* ---- Master rerender ---- */
  function rerenderAll() {
    // Normalize assignments + save
    data.jobs.forEach((job) => getAssignments(job));
    saveData(data);

    // Main cards
    renderAssignWorkers(data);
    renderWorkersTable(data);
    renderUpcomingMini(data);
    renderUpcomingFull(data);
    renderCompletedJobs(data);

    // Populate Finalize Job dropdown with only "report needed" jobs
    const finalizeSelect = document.getElementById('finalize-job-select');
    if (finalizeSelect) {
      finalizeSelect.innerHTML = '<option value="">Select a job…</option>';

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sorted = sortJobsByDateTime(data.jobs).filter((job) => {
        if (!job.date) return false;
        const d = new Date(job.date + 'T00:00:00');
        if (isNaN(d)) return false;

        const isPastOrToday = d <= today;
        const reportDone = !!job.reportCompleted;

        // Only show jobs that are today or earlier AND not yet finalized
        return isPastOrToday && !reportDone;
      });

      if (!sorted.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.textContent = 'No jobs need reports right now.';
        finalizeSelect.appendChild(opt);
      } else {
        sorted.forEach((job) => {
          const opt = document.createElement('option');
          opt.value = job.id;
          const labelParts = [];
          if (job.date) labelParts.push(formatDateShort(job.date));
          if (job.name) labelParts.push(job.name);
          opt.textContent = labelParts.join(' – ') || '(no name)';
          finalizeSelect.appendChild(opt);
        });
      }
    }
  }

  window._crewtechRerenderAll = rerenderAll;
  rerenderAll();
  refreshWorkersFromSupabase();
  refreshJobsFromSupabase();

  /* ---- Splash screen ---- */
  const splash = document.getElementById('splash-overlay');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('splash-hide');
      splash.addEventListener(
        'transitionend',
        () => {
          if (splash && splash.parentNode) {
            splash.parentNode.removeChild(splash);
          }
        },
        { once: true }
      );
    }, 1400);
  }
});
