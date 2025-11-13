// Worker Portal – Phase 1: read workerId, bucket jobs, render 3 sections

const STORAGE_KEY = 'crewtech-data-v1';

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workers: [], jobs: [] };
    const parsed = JSON.parse(raw);
    return {
      workers: parsed.workers || [],
      jobs: parsed.jobs || [],
    };
  } catch {
    return { workers: [], jobs: [] };
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
    year: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m || 0), 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
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
  // Containers that MUST exist
  const openGroup = byId('open-jobs');             // <div id="open-jobs">
  const upcomingGroup = byId('upcoming-jobs');     // <div id="upcoming-jobs">
  const completedGroup = byId('completed-jobs');   // <div id="completed-jobs">
  const meta = byId('worker-meta');                // <p id="worker-meta">
  const upcomingToggle = byId('upcoming-more-toggle'); // button at bottom of Upcoming section

  if (!openGroup || !upcomingGroup || !completedGroup || !meta) {
    console.error('Worker containers not found:', {
      openGroup,
      upcomingGroup,
      completedGroup,
      meta,
    });
    removeSplash();
    return;
  }

  const data = loadData();

  // --- Who is this worker? -----------------------------------
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

  meta.textContent = `Viewing schedule for: ${worker.name}`;

  // --- Helper to get a real Date for a job -------------------
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

  // --- Buckets for this worker ------------------------------
  const buckets = {
    invited: [],
    upcoming: [],
    completed: [],
  };

  (data.jobs || []).forEach((job) => {
    const assignments = getAssignments(job);
    const a = assignments.find((a) => a.workerId === workerId);
    if (!a) return;

    const status = (shortStatus(a.status) || 'invited').toLowerCase();

    // Never show declined in worker view
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

  // --- Generic simple job card (for Upcoming + Completed) ----
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

    if (job.date) {
      bits.push(formatDate(job.date));
    }

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

  // --- OPEN JOBS: Confirm / Decline buttons ------------------
  function renderOpenJobs(targetEl, jobs) {
    targetEl.innerHTML = '';

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

        // Title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'job-card-title';
        titleDiv.textContent = job.name || '(no name)';
        card.appendChild(titleDiv);

        // Meta row
        const metaDiv = document.createElement('div');
        metaDiv.className = 'job-card-meta';
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

        metaDiv.textContent = bits.join(' • ');
        card.appendChild(metaDiv);

        // Notes (if any)
        if (job.notes) {
          const notes = document.createElement('div');
          notes.className = 'job-card-workers';
          notes.textContent = job.notes;
          card.appendChild(notes);
        }

        // Button row (Confirm + Decline) – centered via CSS
        const actionsRow = document.createElement('div');

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'small';
        confirmBtn.textContent = 'Confirm Shift';

        const declineBtn = document.createElement('button');
        declineBtn.className = 'small danger';
        declineBtn.textContent = 'Decline';

        // Phase 1: just log (no data mutation yet)
        confirmBtn.addEventListener('click', () => {
          console.log('Confirm clicked for job', job.id);
        });
        declineBtn.addEventListener('click', () => {
          console.log('Decline clicked for job', job.id);
        });

        actionsRow.appendChild(confirmBtn);
        actionsRow.appendChild(declineBtn);
        card.appendChild(actionsRow);

        targetEl.appendChild(card);
      });
  }

  // --- UPCOMING SHIFTS: show 3 + toggle ----------------------
  function renderUpcomingJobs(targetEl, jobs) {
    targetEl.innerHTML = '';

    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'You don’t have any upcoming shifts yet.';
      targetEl.appendChild(empty);

      if (upcomingToggle) {
        upcomingToggle.style.display = 'none';
      }
      return;
    }

    const sorted = jobs
      .slice()
      .sort((a, b) => {
        const da = getJobDate(a) || new Date(8640000000000000);
        const db = getJobDate(b) || new Date(8640000000000000);
        return da - db;
      });

    const MAX_VISIBLE = 3;
    const visible = sorted.slice(0, MAX_VISIBLE);
    const hidden = sorted.slice(MAX_VISIBLE);

    // Render visible cards
    visible.forEach((job) => {
      const card = buildSimpleJobCard(job, { showStatusPill: true });
      targetEl.appendChild(card);
    });

    // Wire up the existing "Show more shifts" button in HTML
    if (!upcomingToggle) return;

    if (!hidden.length) {
      upcomingToggle.style.display = 'none';
      return;
    }

    upcomingToggle.style.display = 'inline-flex';
    const labelSpan = upcomingToggle.querySelector('.label');
    const caretSpan = upcomingToggle.querySelector('.caret');

    let expanded = false;

    // Reset initial state
    upcomingToggle.setAttribute('aria-expanded', 'false');
    if (labelSpan) {
      labelSpan.textContent = `Show ${hidden.length} more shift${
        hidden.length > 1 ? 's' : ''
      }`;
    }
    if (caretSpan) caretSpan.textContent = '▾';

    // Remove any old click behavior and reassign
    upcomingToggle.onclick = () => {
      expanded = !expanded;

      if (expanded) {
        // Add hidden cards
        hidden.forEach((job) => {
          const card = buildSimpleJobCard(job, { showStatusPill: true });
          targetEl.appendChild(card);
        });
        if (labelSpan) labelSpan.textContent = 'Show fewer shifts';
        if (caretSpan) caretSpan.textContent = '▴';
        upcomingToggle.setAttribute('aria-expanded', 'true');
      } else {
        // Collapse back to only first three
        targetEl.innerHTML = '';
        visible.forEach((job) => {
          const card = buildSimpleJobCard(job, { showStatusPill: true });
          targetEl.appendChild(card);
        });
        if (labelSpan) {
          labelSpan.textContent = `Show ${hidden.length} more shift${
            hidden.length > 1 ? 's' : ''
          }`;
        }
        if (caretSpan) caretSpan.textContent = '▾';
        upcomingToggle.setAttribute('aria-expanded', 'false');
      }
    };
  }

  // --- COMPLETED JOBS: grouped by month w/ caret -------------
  function renderCompletedJobs(targetEl, jobs) {
    targetEl.innerHTML = '';

    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No completed shifts yet.';
      targetEl.appendChild(empty);
      return;
    }

    const monthMap = new Map();
    // key = "YYYY-MM", value = { key, label, jobs[] }

    jobs.forEach((job) => {
      const d = getJobDate(job);
      if (!d) return;

      const year = d.getFullYear();
      const month = d.getMonth(); // 0-based
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      if (!monthMap.has(key)) {
        monthMap.set(key, { key, label, jobs: [] });
      }
      monthMap.get(key).jobs.push(job);
    });

    const monthGroups = Array.from(monthMap.values()).sort((a, b) =>
      b.key.localeCompare(a.key)
    );

    monthGroups.forEach((group) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'month-group';

      const header = document.createElement('div');
      header.className = 'month-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'month-title';
      titleSpan.textContent = group.label;

      const countSpan = document.createElement('span');
      countSpan.className = 'month-count';
      countSpan.textContent = `${group.jobs.length} shift${
        group.jobs.length > 1 ? 's' : ''
      }`;

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'month-arrow';
      arrowSpan.textContent = '▾';

      header.appendChild(titleSpan);
      header.appendChild(countSpan);
      header.appendChild(arrowSpan);

      const body = document.createElement('div');
      body.className = 'month-body';

      group.jobs
        .slice()
        .sort((a, b) => {
          const da = getJobDate(a) || new Date(0);
          const db = getJobDate(b) || new Date(0);
          return da - db;
        })
        .forEach((job) => {
          const card = buildSimpleJobCard(job, { showStatusPill: true });
          body.appendChild(card);
        });

      let open = true;
      header.addEventListener('click', () => {
        open = !open;
        body.style.display = open ? 'block' : 'none';
        arrowSpan.textContent = open ? '▾' : '▸';
      });

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      targetEl.appendChild(wrapper);
    });
  }

  // --- Render all three sections -----------------------------
  renderOpenJobs(openGroup, buckets.invited);
  renderUpcomingJobs(upcomingGroup, buckets.upcoming);
  renderCompletedJobs(completedGroup, buckets.completed);

  // Hide splash once everything is drawn
  removeSplash();
});
