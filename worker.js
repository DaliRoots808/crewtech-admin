// ==============================
// Worker Portal Logic (Clean)
// ==============================

const STORAGE_KEY = 'crewtech-data-v1';
let currentWorkerForSms = null;
let smsPrefLabel = null;
let smsToggle = null;
let phoneInput = null;
let phoneSaveBtn = null;
let phoneRowEl = null;

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workers: [], jobs: [] };
    const parsed = JSON.parse(raw);
    return {
      workers: parsed.workers || [],
      jobs: parsed.jobs || []
    };
  } catch (e) {
    console.error('Failed to load data:', e);
    return { workers: [], jobs: [] };
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

function byId(id) {
  return document.getElementById(id);
}

function saveWorker(worker) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.workers)) return;
    const idx = data.workers.findIndex((w) => w.id === worker.id);
    if (idx !== -1) {
      data.workers[idx] = worker;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch (err) {
    console.warn('[Worker portal] saveWorker failed', err);
  }
}

function showSmsToast(message) {
  const toast = document.getElementById('sms-toast');
  if (!toast) return;

  toast.textContent = message;

  toast.classList.add('visible');

  // Clear any previous timeout so rapid toggles don’t stack
  if (window.__smsToastTimeout) {
    clearTimeout(window.__smsToastTimeout);
  }

  window.__smsToastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2600);
}

function normalizeUSPhoneToE164(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10) {
    return '+1' + digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }
  if (raw.startsWith('+1') && digits.length === 11) {
    return raw;
  }
  return null;
}

function formatUSPhoneForInput(raw) {
  if (!raw) return '';

  // Keep only digits
  let digits = String(raw).replace(/\D+/g, '');

  // If they included a leading “1”, drop it for display
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  // We only care about up to 10 digits for pretty display
  if (digits.length > 10) {
    digits = digits.slice(0, 10);
  }

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  // 7–10 digits
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Take a stored E.164 US number like +17025551842 and pretty-format it
function prettyFromStoredPhone(phone) {
  if (!phone) return '';
  // Strip to digits first
  let digits = phone.replace(/\D+/g, '');
  // Remove leading country code “1” for display
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  return formatUSPhoneForInput(digits);
}

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

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m || 0), 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getAssignments(job) {
  if (!job.assignments || !Array.isArray(job.assignments)) {
    const baseIds = job.assignedWorkerIds || [];
    job.assignments = baseIds.map((id) => ({ workerId: id, status: '' }));
  }
  job.assignedWorkerIds = job.assignments.map((a) => a.workerId);
  return job.assignments;
}

function shortStatus(code) {
  const c = String(code || '').trim().toLowerCase();
  if (c === 'confirmed') return 'confirmed';
  if (c === 'invited') return 'invited';
  if (c === 'declined') return 'declined';
  return '';
}

function removeSplash() {
  const splash = byId('splash-overlay');
  if (!splash) return;
  setTimeout(() => {
    splash.classList.add('splash-hide');
    splash.addEventListener(
      'transitionend',
      () => {
        splash?.parentNode?.removeChild(splash);
      },
      { once: true }
    );
  }, 800);
}

async function fetchWorkerFromSupabase(workerId) {
  try {
    const res = await fetch(
      '/.netlify/functions/getWorkersFromSupabase?workerId=' +
        encodeURIComponent(workerId)
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !Array.isArray(json) || json.length === 0) {
      return;
    }
    const row = json[0];

    if (row.sms_opt_in === true || row.sms_opt_in === false) {
      const data = loadData();
      const local = (data.workers || []).find((w) => w.id === workerId);
      if (local) {
        local.sms_opt_in = row.sms_opt_in ? 'on' : 'off';
        saveData(data);
        if (currentWorkerForSms && currentWorkerForSms.id === workerId) {
          currentWorkerForSms.sms_opt_in = row.sms_opt_in ? 'on' : 'off';
          updateSmsPreferenceRow(currentWorkerForSms);
        }
      }
    }
  } catch (err) {
    console.warn('[fetchWorkerFromSupabase] error', err);
  }
}

async function fetchWorkerFromSupabaseById(workerId) {
  if (!workerId) return null;

  try {
    console.log("[Worker Portal] Fetching worker from Supabase by id:", workerId);
    const res = await fetch(
      `/.netlify/functions/getWorkerFromSupabaseById?workerId=${encodeURIComponent(
        workerId
      )}`
    );

    if (!res.ok) {
      console.warn(
        "[Worker Portal] Supabase worker fetch failed",
        res.status
      );
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!data || !data.found || !data.worker) {
      console.log(
        "[Worker Portal] Supabase returned no worker for id",
        workerId
      );
      return null;
    }

    const w = data.worker;

    // Normalize into the shape our UI expects.
    const normalized = {
      id: w.id,
      name: w.name,
      phone: w.phone,
      sms_opt_in:
        typeof w.sms_opt_in === "boolean"
          ? w.sms_opt_in
          : w.sms_opt_in === null || w.sms_opt_in === undefined
          ? null
          : !!w.sms_opt_in
    };

    console.log("[Worker Portal] Supabase worker found", normalized);
    return normalized;
  } catch (err) {
    console.warn("[Worker Portal] Error fetching worker from Supabase", err);
    return null;
  }
}

async function upsertWorkerToSupabaseIfAvailable(worker) {
  try {
    // Normalize sms_opt_in into a real boolean (or null) for Supabase
    let smsBool = null;
    if (worker.sms_opt_in === 'on' || worker.sms_opt_in === true) {
      smsBool = true;
    } else if (worker.sms_opt_in === 'off' || worker.sms_opt_in === false) {
      smsBool = false;
    }

    const res = await fetch('/.netlify/functions/upsertWorkerToSupabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker: {
          id: worker.id,
          name: worker.name,
          phone: worker.phone,
          sms_opt_in: smsBool
        }
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      console.warn('[Worker portal] Supabase upsert failed', json);
    }
  } catch (err) {
    console.warn('[Worker portal] Supabase upsert error', err);
  }
}


async function refreshJobsFromSupabaseIfAvailable(data) {
  try {
    if (["localhost","127.0.0.1"].includes(window.location.hostname)) return;
    const res = await fetch("/.netlify/functions/getJobsFromSupabase", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !Array.isArray(json.jobs)) {
      console.warn("[Worker portal] getJobsFromSupabase failed", res.status, json);
      return;
    }
    if (data && typeof data === "object") {
      data.jobs = json.jobs;
      saveData(data);
    }
  } catch (err) {
    console.warn("[Worker portal] refreshJobsFromSupabase error", err);
  }
}

async function syncJobToSupabaseFromWorker(job) {
  try {
    if (["localhost","127.0.0.1"].includes(window.location.hostname)) return;
    const res = await fetch("/.netlify/functions/syncJobToSupabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: { id: job.id, assignments: job.assignments } })
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.success) {
      console.warn("[Worker portal] syncJobToSupabase failed", res.status, json);
    }
  } catch (err) {
    console.warn("[Worker portal] syncJobToSupabase error", err);
  }
}


function updateSmsPreferenceRow(worker) {
  const labelEl = smsPrefLabel || document.getElementById('sms-pref-label');
  const toggleEl = smsToggle || document.getElementById('sms-opt-in-toggle');

  if (!labelEl || !toggleEl || !worker) return;

  const state = worker.sms_opt_in; // null | 'on' | 'off' | boolean

  // Normalize booleans into 'on'/'off'
  let normalized;
  if (state === true) normalized = 'on';
  else if (state === false) normalized = 'off';
  else normalized = state;

  if (normalized === 'on') {
    labelEl.textContent = 'SMS Alerts: ON (job invites & schedule updates)';
    toggleEl.checked = true;
  } else if (normalized === 'off') {
    labelEl.textContent = 'SMS Alerts: OFF';
    toggleEl.checked = false;
  } else {
    // null / undefined / anything else
    labelEl.textContent = 'SMS Alerts: not set';
    toggleEl.checked = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const openGroup = byId('open-jobs');
  const upcomingGroup = byId('upcoming-jobs');
  const completedGroup = byId('completed-jobs');
  const meta = byId('worker-meta');
  phoneInput = byId('worker-phone-input');
  phoneSaveBtn = byId('worker-phone-save-btn');

  phoneRowEl = byId('worker-phone-row');
  const phoneInputEl = phoneInput;
  const phoneSaveBtnEl = phoneSaveBtn;
  // Cache SMS preference elements globally
  smsPrefLabel = byId('sms-pref-label');
  smsToggle = byId('sms-opt-in-toggle');

  if (!openGroup || !upcomingGroup || !completedGroup || !meta) {
    console.error('Worker containers not found:', {
      openGroup,
      upcomingGroup,
      completedGroup,
      meta
    });
    removeSplash();
    return;
  }

  const data = loadData();
  smsPrefLabel = byId('sms-pref-label');
  smsToggle = byId('sms-opt-in-toggle');
  await refreshJobsFromSupabaseIfAvailable(data);

  // --- Worker from URL ---
  const url = new URL(window.location.href);
  const workerId = url.searchParams.get('workerId');

  if (!workerId) {
    meta.textContent =
      'No workerId found in the link. Ask your admin for your personal link.';
    removeSplash();
    return;
  }

  let worker = (data.workers || []).find((w) => w.id === workerId);

  // If worker not found locally but we have a workerId, try Supabase.
  if (!worker && workerId) {
    const supaWorker = await fetchWorkerFromSupabaseById(workerId);
    if (supaWorker) {
      worker = supaWorker;

      // Cache into local data so this browser recognizes the link next time.
      if (!Array.isArray(data.workers)) {
        data.workers = [];
      }
      const existingIndex = data.workers.findIndex((w) => w.id === workerId);
      if (existingIndex >= 0) {
        data.workers[existingIndex] = supaWorker;
      } else {
        data.workers.push(supaWorker);
      }
      if (typeof saveData === "function") {
        try {
          saveData(data);
        } catch (e) {
          console.warn("[Worker Portal] Failed to save Supabase worker locally", e);
        }
      }
    }
  }
  if (!worker) {
    meta.textContent =
      'This worker link is not recognized on this device yet.';
    removeSplash();
    return;
  }

  if (typeof worker.sms_opt_in === 'undefined') {
    worker.sms_opt_in = null; // null = hasn't decided yet
  } else if (worker.sms_opt_in === true) {
    worker.sms_opt_in = 'on';
  } else if (worker.sms_opt_in === false) {
    worker.sms_opt_in = 'off';
  }
  currentWorkerForSms = worker;
  saveWorker(currentWorkerForSms);

  await fetchWorkerFromSupabase(workerId);
  if (currentWorkerForSms?.sms_opt_in === undefined) {
    currentWorkerForSms.sms_opt_in = null;
    saveWorker(currentWorkerForSms);
  }
  if (
    currentWorkerForSms &&
    (currentWorkerForSms.sms_opt_in === 'on' ||
      currentWorkerForSms.sms_opt_in === 'off' ||
      currentWorkerForSms.sms_opt_in === true ||
      currentWorkerForSms.sms_opt_in === false)
  ) {
    updateSmsPreferenceRow(currentWorkerForSms);
  }

  if (currentWorkerForSms && currentWorkerForSms.sms_opt_in === null) {
    showSmsConsentModal();
  }

  const yesBtn = document.getElementById('sms-consent-yes');
  const noBtn = document.getElementById('sms-consent-no');

  if (yesBtn) {
    yesBtn.addEventListener('click', async () => {
      if (!currentWorkerForSms) return;
      currentWorkerForSms.sms_opt_in = 'on';
      saveWorker(currentWorkerForSms);
      await upsertWorkerToSupabaseIfAvailable(currentWorkerForSms);
      hideSmsConsentModal();
      updateSmsPreferenceRow(currentWorkerForSms);
      if (smsToggle) smsToggle.checked = true;
    });
  }

  if (noBtn) {
    noBtn.addEventListener('click', async () => {
      if (!currentWorkerForSms) return;
      currentWorkerForSms.sms_opt_in = 'off';
      saveWorker(currentWorkerForSms);
      await upsertWorkerToSupabaseIfAvailable(currentWorkerForSms);
      hideSmsConsentModal();
      updateSmsPreferenceRow(currentWorkerForSms);
      if (smsToggle) smsToggle.checked = false;
    });
  }

  updateSmsPreferenceRow(currentWorkerForSms);

  // Initialize phone input and toggle Save visibility
  // Initialize phone input and toggle Save visibility
  if (phoneInput && phoneSaveBtn) {
    const refreshSaveVisibility = () => {
      const hasText = phoneInput.value.trim().length > 0;
      phoneSaveBtn.style.display = hasText ? 'inline-flex' : 'none';
    };

    phoneInput.addEventListener('input', () => {
      const raw = phoneInput.value;
      const digits = raw.replace(/\D+/g, '');

      // If user deleted everything, clear the field and hide Save
      if (!digits) {
        phoneInput.value = '';
        refreshSaveVisibility();
        return;
      }

      // Reformat into a friendly US pattern as they type
      const pretty = formatUSPhoneForInput(digits);
      phoneInput.value = pretty;
      refreshSaveVisibility();
    });

    phoneInput.addEventListener('focus', refreshSaveVisibility);

    phoneInput.addEventListener('blur', () => {
      if (!phoneInput.value.trim()) {
        phoneSaveBtn.style.display = 'none';
      }
    });

    // Initial state
    refreshSaveVisibility();
  }

  if (phoneSaveBtn && phoneInput) {
    phoneSaveBtn.addEventListener('click', async () => {
      const raw = phoneInput.value.trim();
      if (!raw) {
        alert('Please enter a phone number before saving.');
        return;
      }
      if (raw.length < 8) {
        alert('That phone number looks too short. Please double-check it.');
        return;
      }

      // Normalize to E.164 before saving
      const formatted = normalizeUSPhoneToE164(raw);
      if (!formatted) {
        alert(
          'Please enter a valid US mobile number.\nExamples:\n702-555-1234\n+17025551234'
        );
        return;
      }

      // Update in-memory worker
      worker.phone = formatted;

      // Persist locally (reuse your existing save helper)
      if (typeof saveWorker === 'function') {
        saveWorker(worker);
      } else if (typeof saveData === 'function' && typeof data !== 'undefined') {
        // Fallback if workers live inside a data object
        const idx = (data.workers || []).findIndex(w => w.id === worker.id);
        if (idx !== -1) {
          data.workers[idx] = worker;
          saveData(data);
        }
      }

      // Upsert to Supabase via existing helper, if available
      try {
        await upsertWorkerToSupabaseIfAvailable(worker);
      } catch (err) {
        console.warn(
          '[Worker portal] Supabase upsert failed after phone save',
          err
        );
      }

      // Keep SMS label/toggle matching current sms_opt_in state
      updateSmsPreferenceRow(worker);

      // Show a small toast instead of a blocking alert
      showSmsToast('Phone number updated for CrewTech SMS notifications.');

      // NEW: Reset the phone editor back to its idle state
      if (phoneInput) {
        phoneInput.value = '';
        phoneInput.blur();
      }
      if (phoneSaveBtn) {
        phoneSaveBtn.style.display = 'none';
      }
    });
  }

  // Centered meta line (styled in CSS)
  meta.textContent = `Viewing schedule for: ${worker.name}`;

  // --- Helpers ---

  function getJobDate(job) {
    if (!job.date) return null;
    const dateStr = job.date;
    const timeStr = job.startTime || '00:00';
    const d = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(d.getTime())) return null;
    return d;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function buildBuckets() {
    const buckets = {
      invited: [],
      upcoming: [],
      completed: []
    };

    (data.jobs || []).forEach((job) => {
      const assignments = getAssignments(job);
      const a = assignments.find((a) => a.workerId === workerId);
      if (!a) return;

      const status = (shortStatus(a.status) || 'invited').toLowerCase();

      // Never show declined anywhere in worker view
      if (status === 'declined') return;

      if (status === 'invited') {
        buckets.invited.push(job);
        return;
      }

      if (status === 'confirmed') {
        const jd = getJobDate(job);
        if (!jd) {
          buckets.upcoming.push(job);
          return;
        }
        if (jd < today) {
          buckets.completed.push(job);
        } else {
          buckets.upcoming.push(job);
        }
      }
    });

    console.log('DEBUG worker buckets:', buckets);
    return buckets;
  }

  // --- UI Card Builders ---

  function buildSimpleJobCard(job, options = {}) {
    const card = document.createElement('div');
    card.className = 'job-card';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'job-card-title';
    titleDiv.textContent = job.name || '(no name)';
    card.appendChild(titleDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'job-card-meta';
    const bits = [];

    if (job.date) bits.push(`<strong>${formatDate(job.date)}</strong>`);

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

    metaDiv.innerHTML = bits.join(' • ');
    card.appendChild(metaDiv);

    if (job.notes) {
      const notes = document.createElement('div');
      notes.className = 'job-card-workers';
      notes.textContent = job.notes;
      card.appendChild(notes);
    }

    if (options.showStatusPill) {
      const statusRow = document.createElement('div');
      const pill = document.createElement('span');
      pill.className = 'status-pill confirmed';
      pill.textContent = 'Confirmed';
      statusRow.appendChild(pill);
      card.appendChild(statusRow);
    }

    return card;
  }

  // --- Renderers ---

  function renderOpenJobs(targetEl, jobs) {
    targetEl.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent =
      'Review your open invites below. Confirm or decline each shift.';
    targetEl.appendChild(hint);

    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent =
        'No open invites right now. We’ll text you when something new comes up.';
      targetEl.appendChild(empty);
      return;
    }

    jobs
      .slice()
      .sort((a, b) => {
        const da = getJobDate(a) || new Date(8640000000000000);
        const db = getJobDate(b) || new Date(8640000000000000);
        return da - db;
      })
      .forEach((job) => {
        const card = document.createElement('div');
        card.className = 'job-card';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'job-card-title';
        titleDiv.textContent = job.name || '(no name)';
        card.appendChild(titleDiv);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'job-card-meta';
        const bits = [];

        if (job.date) bits.push(`<strong>${formatDate(job.date)}</strong>`);
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

        metaDiv.innerHTML = bits.join(' • ');
        card.appendChild(metaDiv);

        if (job.notes) {
          const notes = document.createElement('div');
          notes.className = 'job-card-workers';
          notes.textContent = job.notes;
          card.appendChild(notes);
        }

        // Action row (Confirm / Decline)
        const actionsRow = document.createElement('div');

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'small';
        confirmBtn.textContent = 'Confirm Shift';

        const declineBtn = document.createElement('button');
        declineBtn.className = 'small danger';
        declineBtn.textContent = 'Decline';

        confirmBtn.addEventListener('click', async () => {
          const assignments = getAssignments(job);
          let a = assignments.find((a) => a.workerId === workerId);
          if (!a) {
            a = { workerId, status: 'Confirmed' };
            assignments.push(a);
          } else {
            a.status = 'Confirmed';
          }
          await syncJobToSupabaseFromWorker(job);

          saveData(data);
          refreshAll();
        });

        declineBtn.addEventListener('click', async () => {
          const assignments = getAssignments(job);
          let a = assignments.find((a) => a.workerId === workerId);
          if (!a) {
            a = { workerId, status: 'declined' };
            assignments.push(a);
          } else {
            a.status = 'declined';
          }
          await syncJobToSupabaseFromWorker(job);

          saveData(data);
          refreshAll();
        });

        actionsRow.appendChild(confirmBtn);
        actionsRow.appendChild(declineBtn);
        card.appendChild(actionsRow);

        targetEl.appendChild(card);
      });
  }

  function renderUpcomingJobs(targetEl, jobs) {
  targetEl.innerHTML = '';

  // Hint at top of section
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent =
    'These are the shifts you’ve already confirmed. The soonest ones are on top.';
  targetEl.appendChild(hint);

  if (!jobs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'You don’t have any upcoming shifts yet.';
    targetEl.appendChild(empty);
    return;
  }

  // Sort by date/time ascending
  const sorted = jobs
    .slice()
    .sort((a, b) => {
      const da = getJobDate(a) || new Date(8640000000000000);
      const db = getJobDate(b) || new Date(8640000000000000);
      return da - db;
    });

  // This div will hold ALL the job cards
  const list = document.createElement('div');
  list.id = 'upcoming-jobs-list';
  targetEl.appendChild(list);

  // Build all cards (we'll hide/show in JS)
  sorted.forEach(job => {
    const card = buildSimpleJobCard(job, { showStatusPill: true });
    list.appendChild(card);
  });

  // If 3 or fewer, no toggle needed
  if (sorted.length <= 3) return;

  // --- Toggle logic: 3 vs all ---
  let expanded = false;

  const toggleWrapper = document.createElement('div');
  toggleWrapper.style.display = 'flex';
  toggleWrapper.style.justifyContent = 'flex-end';
  toggleWrapper.style.marginTop = '0.4rem';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'upcoming-toggle';
  toggleBtn.setAttribute('aria-expanded', 'false');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'label';

  const caretSpan = document.createElement('span');
  caretSpan.className = 'caret';

  toggleBtn.appendChild(labelSpan);
  toggleBtn.appendChild(caretSpan);
  toggleWrapper.appendChild(toggleBtn);
  targetEl.appendChild(toggleWrapper);

  function applyVisibility() {
    const cards = list.querySelectorAll('.job-card');
    cards.forEach((card, idx) => {
      if (!expanded && idx >= 3) {
        card.style.display = 'none';
      } else {
        card.style.display = 'block';
      }
    });

    const hiddenCount = Math.max(0, sorted.length - 3);
    if (!expanded) {
      labelSpan.textContent =
        hiddenCount > 1
          ? `Show ${hiddenCount} more shifts`
          : `Show 1 more shift`;
      caretSpan.textContent = '▾';
      list.classList.remove('expanded');
      toggleBtn.setAttribute('aria-expanded', 'false');
    } else {
      labelSpan.textContent = 'Show fewer shifts';
      caretSpan.textContent = '▴';
      list.classList.add('expanded');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
  }

  toggleBtn.addEventListener('click', () => {
    expanded = !expanded;
    applyVisibility();
  });

  // Initial state = collapsed (3 only)
  applyVisibility();
}


  function renderCompletedJobs(targetEl, jobs) {
    targetEl.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent =
      'Once you’ve worked shifts, they’ll show up here as your personal history.';
    targetEl.appendChild(hint);

    if (!jobs.length) return;

    const sorted = jobs
      .slice()
      .sort((a, b) => {
        const da = getJobDate(a) || new Date(0);
        const db = getJobDate(b) || new Date(0);
        return db - da; // newest first
      });

    sorted.forEach((job) => {
      const card = buildSimpleJobCard(job, { showStatusPill: true });
      targetEl.appendChild(card);
    });
  }

  function refreshAll() {
    const buckets = buildBuckets();
    renderOpenJobs(openGroup, buckets.invited);
    renderUpcomingJobs(upcomingGroup, buckets.upcoming);
    renderCompletedJobs(completedGroup, buckets.completed);
  }

  refreshAll();
  removeSplash();

  if (smsToggle) {
    smsToggle.addEventListener('change', async (event) => {
      const checked = event.target.checked;
      console.log('[Worker SMS] Toggle changed, checked =', checked);

      if (!currentWorkerForSms) {
        console.warn('[Worker SMS] No currentWorkerForSms set');
        event.target.checked = false;
        return;
      }

      // Require a phone number before allowing "ON"
      if (
        checked &&
        (!currentWorkerForSms.phone || !currentWorkerForSms.phone.trim())
      ) {
        alert(
          'Please enter your mobile number and tap Save before turning on SMS alerts.'
        );
        event.target.checked = false;
        return;
      }

      // Update local worker state
      currentWorkerForSms.sms_opt_in = checked ? 'on' : 'off';

      // Persist locally
      saveWorker(currentWorkerForSms);

      // Upsert to Supabase (best effort)
      try {
        await upsertWorkerToSupabaseIfAvailable(currentWorkerForSms);
      } catch (err) {
        console.warn('[Worker SMS] Supabase upsert failed', err);
      }

      // Refresh label + toggle from latest state
      updateSmsPreferenceRow(currentWorkerForSms);

      // Optional tiny toast so the worker gets feedback
      const msg = checked
        ? 'SMS alerts turned ON for job invites & schedule updates.'
        : 'SMS alerts turned OFF.';
      showSmsToast(msg);
    });
  }

  updateSmsPreferenceRow(currentWorkerForSms);
});

function showSmsConsentModal() {
  const m = document.getElementById('sms-consent-modal');
  if (m) m.classList.remove('hidden');
}

function hideSmsConsentModal() {
  const m = document.getElementById('sms-consent-modal');
  if (m) m.classList.add('hidden');
}
