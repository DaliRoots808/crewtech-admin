// ==============================
// Worker Portal Logic (Clean)
// ==============================

const STORAGE_KEY = 'crewtech-data-v1';

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
  const c = (code || '').toLowerCase();
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

document.addEventListener('DOMContentLoaded', () => {
  const openGroup = byId('open-jobs');
  const upcomingGroup = byId('upcoming-jobs');
  const completedGroup = byId('completed-jobs');
  const meta = byId('worker-meta');

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

  // --- Worker from URL ---
  const url = new URL(window.location.href);
  const workerId = url.searchParams.get('workerId');

  if (!workerId) {
    meta.textContent =
      'No workerId found in the link. Ask your admin for your personal link.';
    removeSplash();
    return;
  }

  const worker = (data.workers || []).find((w) => w.id === workerId);
  if (!worker) {
    meta.textContent =
      'This worker link is not recognized on this device yet.';
    removeSplash();
    return;
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

        confirmBtn.addEventListener('click', () => {
          const assignments = getAssignments(job);
          let a = assignments.find((a) => a.workerId === workerId);
          if (!a) {
            a = { workerId, status: 'confirmed' };
            assignments.push(a);
          } else {
            a.status = 'confirmed';
          }
          saveData(data);
          refreshAll();
        });

        declineBtn.addEventListener('click', () => {
          const assignments = getAssignments(job);
          let a = assignments.find((a) => a.workerId === workerId);
          if (!a) {
            a = { workerId, status: 'declined' };
            assignments.push(a);
          } else {
            a.status = 'declined';
          }
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
});
