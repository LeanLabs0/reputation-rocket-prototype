(async function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const loginPanel = $('#login-panel');
  const setupPanel = $('#setup-panel');
  const appPanel = $('#app-panel');
  const listView = $('#list-view');
  const detailView = $('#detail-view');
  const clientsEl = $('#clients');
  const logoutBtn = $('#btn-logout');
  const flashEl = $('#flash');
  const loginError = $('#login-error');

  let appState = null;
  let selectedSlug = null;

  showQueryFlash();

  const status = await api('/api/configure/status');
  if (!status.authConfigured) {
    setupPanel.hidden = false;
    return;
  }

  if (!status.authenticated) {
    loginPanel.hidden = false;
    $('#login-form').addEventListener('submit', onLogin);
    return;
  }

  if (!status.oauthConfigured) {
    setupPanel.hidden = false;
    logoutBtn.hidden = false;
    logoutBtn.addEventListener('click', onLogout);
    return;
  }

  appState = status;
  renderList();
  logoutBtn.hidden = false;
  logoutBtn.addEventListener('click', onLogout);

  const params = new URLSearchParams(window.location.search);
  const openSlug = params.get('client') || params.get('connected');
  if (openSlug && status.clients?.some((c) => c.clientSlug === openSlug)) {
    openDetail(openSlug);
  }

  async function onLogin(e) {
    e.preventDefault();
    loginError.hidden = true;
    const password = $('#login-password').value;
    const res = await api('/api/configure/login', {
      method: 'POST',
      body: { password },
    });
    if (!res.ok) {
      loginError.textContent = res.error || 'Login failed';
      loginError.hidden = false;
      return;
    }
    window.location.reload();
  }

  async function onLogout() {
    await api('/api/configure/logout', { method: 'POST', body: {} });
    window.location.reload();
  }

  function renderList() {
    appPanel.hidden = false;
    listView.hidden = false;
    detailView.hidden = true;
    selectedSlug = null;

    $('#storage-mode').textContent = `storage: ${appState.storage?.mode || 'unknown'}`;
    clientsEl.innerHTML = '';
    (appState.clients || []).forEach((client) => {
      clientsEl.appendChild(renderClientRow(client));
    });

    wireCreateForm();
  }

  function wireCreateForm() {
    const toggle = $('#btn-toggle-create');
    const body = $('#create-body');
    const createNote = $('#create-note');
    const createForm = $('#create-form');
    const createErr = $('#create-error');
    const nameInput = $('#create-name');
    const slugInput = $('#create-slug');

    if (toggle.dataset.wired === '1') return;
    toggle.dataset.wired = '1';

    toggle.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    if (!appState.canScaffold) {
      createNote.textContent = 'Folder scaffolding only works locally (npm run dev). On Vercel, add the client folder in git first.';
      $('#btn-create').disabled = true;
    } else {
      createNote.textContent = 'After create, open the client to set experience + Connect HubSpot.';
    }

    nameInput.addEventListener('input', () => {
      if (slugInput.dataset.touched === '1') return;
      slugInput.value = nameInput.value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    });
    slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });

    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      createErr.hidden = true;
      const btn = $('#btn-create');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      const res = await api('/api/configure/create-client', {
        method: 'POST',
        body: {
          providerName: nameInput.value.trim(),
          clientSlug: slugInput.value.trim(),
          supportEmail: $('#create-email').value.trim(),
        },
      });
      if (!res.ok) {
        createErr.textContent = res.message || res.detail || res.error || 'Create failed';
        createErr.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Create folder';
        return;
      }
      const slug = res.client?.clientSlug || slugInput.value.trim();
      window.location.href = `/configure/?client=${encodeURIComponent(slug)}`;
    });
  }

  function renderClientRow(client) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cfg-client-row';
    const connected = Boolean(client.connected);
    const provisioned = Boolean(client.provisionedAt && client.formId);
    const settings = client.portalSettings || {};
    const platforms = (settings.platforms || []).join(', ') || 'no platforms';

    el.innerHTML = `
      <div class="cfg-client-row-main">
        <div>
          <h3>${escapeHtml(client.providerName)}</h3>
          <p class="cfg-muted"><span class="cfg-code">${escapeHtml(client.portalPath)}</span> · ${escapeHtml(platforms)}</p>
        </div>
        <div class="cfg-chips">
          <span class="cfg-chip ${client.folderExists ? 'ok' : 'warn'}">${client.folderExists ? 'Folder' : 'No folder'}</span>
          <span class="cfg-chip ${connected ? 'ok' : 'bad'}">${connected ? 'OAuth' : 'No OAuth'}</span>
          <span class="cfg-chip ${provisioned ? 'ok' : 'warn'}">${provisioned ? 'Form ready' : 'Form pending'}</span>
        </div>
      </div>
      <span class="cfg-client-row-cta">Configure →</span>
    `;
    el.addEventListener('click', () => openDetail(client.clientSlug));
    return el;
  }

  function openDetail(slug) {
    const client = (appState.clients || []).find((c) => c.clientSlug === slug);
    if (!client) return;
    selectedSlug = slug;
    listView.hidden = true;
    detailView.hidden = false;
    detailView.innerHTML = '';
    detailView.appendChild(renderDetail(client));
    history.replaceState({}, '', `/configure/?client=${encodeURIComponent(slug)}`);
  }

  function renderDetail(client) {
    const wrap = document.createElement('div');
    const connected = Boolean(client.connected);
    const provisioned = Boolean(client.provisionedAt && client.formId);
    const propsOk = Boolean(client.properties?.rr_iscomplete && client.properties?.rr_outcome);
    const settings = JSON.parse(JSON.stringify(client.portalSettings || {}));
    const platforms = appState.availablePlatforms || [];

    wrap.innerHTML = `
      <div class="cfg-detail-top">
        <div class="cfg-detail-nav">
          <button type="button" class="cfg-btn cfg-btn-ghost" data-action="back">← All clients</button>
          <button type="button" class="cfg-btn cfg-btn-danger" data-action="delete">
            ${client.isBuiltIn ? 'Uninstall HubSpot' : 'Delete client'}
          </button>
        </div>
        <div class="cfg-detail-title">
          <h2>${escapeHtml(client.providerName)}</h2>
          <p class="cfg-muted">
            <a href="${escapeHtml(client.portalPath)}" target="_blank" rel="noopener">${escapeHtml(client.portalPath)}</a>
            · <span class="cfg-code">${escapeHtml(client.clientSlug)}</span>
            · settings from ${escapeHtml(client.settingsSource || 'defaults')}
          </p>
        </div>
      </div>

      <div class="cfg-tabs" role="tablist">
        <button type="button" class="cfg-tab is-active" data-tab="experience" role="tab" aria-selected="true">Experience</button>
        <button type="button" class="cfg-tab" data-tab="hubspot" role="tab" aria-selected="false">HubSpot</button>
      </div>

      <div class="cfg-tab-panel" data-panel="experience">
        <form id="experience-form" class="cfg-experience">
          <section class="cfg-section">
            <div class="cfg-section-head">
              <h3>Review platforms</h3>
              <p class="cfg-muted">Choose where customers post. Add the review form URL for each.</p>
            </div>
            <div class="cfg-platform-grid" id="platform-grid"></div>
            <div class="cfg-link-stack" id="review-link-stack"></div>
          </section>

          <section class="cfg-section">
            <div class="cfg-section-head">
              <h3>Welcome media</h3>
              <p class="cfg-muted">Optional intro video on the first screen.</p>
            </div>
            <div class="cfg-grid-2">
              <label>Welcome video URL
                <input type="url" name="welcomeVideoUrl" value="${escapeAttr(settings.welcomeVideoUrl || '')}" placeholder="https://…/intro.mp4">
              </label>
              <label>Poster image URL
                <input type="url" name="welcomeVideoPoster" value="${escapeAttr(settings.welcomeVideoPoster || '')}" placeholder="https://…/poster.gif">
              </label>
            </div>
          </section>

          <section class="cfg-section">
            <div class="cfg-section-head">
              <div>
                <h3>Interview questions</h3>
                <p class="cfg-muted">Shown on the video step and record modal.</p>
              </div>
              <label class="cfg-switch">
                <input type="checkbox" name="videoCaptureEnabled" ${settings.videoCaptureEnabled ? 'checked' : ''}>
                <span>Video capture enabled</span>
              </label>
            </div>
            <div id="questions-list" class="cfg-questions"></div>
            <button type="button" class="cfg-btn" data-action="add-question">+ Add question</button>
          </section>

          <section class="cfg-section">
            <div class="cfg-section-head">
              <h3>Thank-you & redirects</h3>
              <p class="cfg-muted">Where to send people after they finish.</p>
            </div>
            <div class="cfg-grid-2">
              <label>Thank-you URL
                <input type="url" name="thankYouUrl" value="${escapeAttr(settings.thankYouUrl || '')}" placeholder="https://…">
              </label>
              <label>Redirect delay (seconds)
                <input type="number" name="thankYouRedirectDelaySec" min="0" step="1" value="${escapeAttr(String(Math.round((settings.thankYouRedirectDelayMs || 0) / 1000)))}">
              </label>
              <label class="cfg-span-2">Allowed redirect hosts <span class="cfg-hint">(comma-separated)</span>
                <input type="text" name="allowedRedirectHosts" value="${escapeAttr((settings.allowedRedirectHosts || []).join(', '))}" placeholder="example.com, www.example.com">
              </label>
              <label class="cfg-span-2">Support email
                <input type="email" name="supportEmail" value="${escapeAttr(settings.supportEmail || '')}" placeholder="support@example.com">
              </label>
            </div>
          </section>

          <div class="cfg-save-bar">
            <p class="cfg-muted" id="save-hint">Saves to the configure store${appState.canScaffold ? ' and writes config.js' : ''}.</p>
            <button type="submit" class="cfg-btn cfg-btn-primary" id="btn-save-experience">Save experience</button>
          </div>
          <p id="experience-error" class="cfg-error" hidden></p>
        </form>
      </div>

      <div class="cfg-tab-panel" data-panel="hubspot" hidden>
        <div class="cfg-card cfg-hubspot-card">
          <div class="cfg-client-top">
            <div>
              <h3>HubSpot install</h3>
              <p class="cfg-muted">OAuth provides runtime API access — no private-app PAT needed.</p>
            </div>
            <div class="cfg-actions">
              <button type="button" class="cfg-btn cfg-btn-primary" data-action="connect">${connected ? 'Reconnect HubSpot' : 'Connect HubSpot'}</button>
              <button type="button" class="cfg-btn cfg-btn-success" data-action="provision" ${connected || client.hasEnvPat ? '' : 'disabled'}>Run HubSpot setup</button>
            </div>
          </div>
          <ul class="cfg-checklist">
            <li><span class="cfg-dot ${client.folderExists ? 'ok' : 'warn'}"></span><span>Local folder <span class="cfg-code">${escapeHtml(client.clientSlug)}/</span></span></li>
            <li><span class="cfg-dot ${connected ? 'ok' : 'bad'}"></span><span>OAuth connected ${connected ? '(API key via refresh token)' : ''}</span></li>
            <li><span class="cfg-dot ${propsOk ? 'ok' : 'warn'}"></span><span>Properties rr_iscomplete + rr_outcome</span></li>
            <li><span class="cfg-dot ${provisioned ? 'ok' : 'warn'}"></span><span>Form “[LL] Reputation Rocket - Sign in” ${client.formId ? `· ${escapeHtml(client.formId)}` : ''}</span></li>
            <li><span class="cfg-dot ${client.portalId ? 'ok' : 'bad'}"></span><span>Portal ID: <span class="cfg-code">${escapeHtml(client.portalId || '—')}</span></span></li>
          </ul>
          <p class="cfg-muted" style="margin-top:14px">Still in code: brand CSS, Slack channel + thread TS.</p>
        </div>
      </div>
    `;

    // Platforms
    const grid = $('#platform-grid', wrap);
    const selected = new Set(settings.platforms || []);
    platforms.forEach((plat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cfg-platform-chip ${selected.has(plat.id) ? 'is-on' : ''}`;
      btn.dataset.platform = plat.id;
      btn.innerHTML = `<span>${escapeHtml(plat.label)}</span>`;
      btn.addEventListener('click', () => {
        if (selected.has(plat.id)) selected.delete(plat.id);
        else selected.add(plat.id);
        btn.classList.toggle('is-on', selected.has(plat.id));
        renderReviewLinks();
      });
      grid.appendChild(btn);
    });

    const linkStack = $('#review-link-stack', wrap);
    function renderReviewLinks() {
      linkStack.innerHTML = '';
      [...selected].forEach((id) => {
        const meta = platforms.find((p) => p.id === id) || { id, label: id };
        const label = document.createElement('label');
        label.innerHTML = `${escapeHtml(meta.label)} review URL
          <input type="url" data-review-link="${escapeAttr(id)}" value="${escapeAttr((settings.reviewLinks || {})[id] || '')}" placeholder="https://…">`;
        linkStack.appendChild(label);
      });
    }
    renderReviewLinks();

    // Questions
    const qList = $('#questions-list', wrap);
    let questions = Array.isArray(settings.interviewQuestions) ? [...settings.interviewQuestions] : [];
    function renderQuestions() {
      qList.innerHTML = '';
      questions.forEach((q, i) => {
        const row = document.createElement('div');
        row.className = 'cfg-question-row';
        row.innerHTML = `
          <span class="cfg-question-num">${i + 1}</span>
          <input type="text" value="${escapeAttr(q)}" data-q-index="${i}" placeholder="Interview question">
          <button type="button" class="cfg-icon-btn" data-remove-q="${i}" aria-label="Remove question">×</button>
        `;
        qList.appendChild(row);
      });
      $$('[data-q-index]', qList).forEach((input) => {
        input.addEventListener('input', () => {
          questions[Number(input.dataset.qIndex)] = input.value;
        });
      });
      $$('[data-remove-q]', qList).forEach((btn) => {
        btn.addEventListener('click', () => {
          questions.splice(Number(btn.dataset.removeQ), 1);
          renderQuestions();
        });
      });
    }
    renderQuestions();
    $('[data-action="add-question"]', wrap).addEventListener('click', () => {
      questions.push('');
      renderQuestions();
      const inputs = $$('input[data-q-index]', qList);
      inputs[inputs.length - 1]?.focus();
    });

    // Tabs
    $$('.cfg-tab', wrap).forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.cfg-tab', wrap).forEach((t) => {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        $$('.cfg-tab-panel', wrap).forEach((panel) => {
          panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        });
      });
    });

    $('[data-action="back"]', wrap).addEventListener('click', () => {
      history.replaceState({}, '', '/configure/');
      renderList();
    });

    $('[data-action="delete"]', wrap).addEventListener('click', async () => {
      const builtIn = Boolean(client.isBuiltIn);
      const ok = window.confirm(
        builtIn
          ? `Uninstall HubSpot for “${client.providerName}”?\n\nThis will:\n• Archive “[LL] Reputation Rocket - Sign in”\n• Delete rr_iscomplete + rr_outcome\n• Clear OAuth / configure store\n\nThe client folder stays (built-in).`
          : `Delete “${client.providerName}” (${client.clientSlug})?\n\nThis will:\n• Archive “[LL] Reputation Rocket - Sign in” in HubSpot\n• Delete rr_iscomplete + rr_outcome\n• Clear configure store\n• Remove local /${client.clientSlug}/ folder`,
      );
      if (!ok) return;

      const btn = $('[data-action="delete"]', wrap);
      btn.disabled = true;
      btn.textContent = builtIn ? 'Uninstalling…' : 'Deleting…';

      const res = await api('/api/configure/delete-client', {
        method: 'POST',
        body: { clientSlug: client.clientSlug },
      });

      if (!res.ok) {
        showFlash(res.detail || res.message || res.error || 'Delete failed', 'error');
        btn.disabled = false;
        btn.textContent = builtIn ? 'Uninstall HubSpot' : 'Delete client';
        return;
      }

      const warn = (res.warnings || []).join(' ');
      showFlash(
        warn ? `${res.summary || 'Done'}. ${warn}` : (res.summary || `Removed ${client.providerName}`),
        warn ? 'warn' : 'ok',
      );

      // Refresh status so built-ins reappear disconnected; dynamic clients drop out.
      const next = await api('/api/configure/status');
      if (next.ok) appState = next;
      history.replaceState({}, '', '/configure/');
      renderList();
    });

    $('[data-action="connect"]', wrap).addEventListener('click', async () => {
      const res = await api('/api/configure/oauth-start', {
        method: 'POST',
        body: { clientSlug: client.clientSlug },
      });
      if (!res.ok || !res.installUrl) {
        showFlash(res.error || res.detail || 'Could not start OAuth', 'error');
        return;
      }
      window.location.href = res.installUrl;
    });

    $('[data-action="provision"]', wrap).addEventListener('click', async (btnEv) => {
      const btn = btnEv.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Provisioning…';
      const res = await api('/api/configure/provision', {
        method: 'POST',
        body: { clientSlug: client.clientSlug },
      });
      if (!res.ok) {
        showFlash(res.message || res.error || 'Provision failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Run HubSpot setup';
        return;
      }
      showFlash(`Provisioned ${client.providerName}`, 'ok');
      window.location.href = `/configure/?client=${encodeURIComponent(client.clientSlug)}&connected=${encodeURIComponent(client.clientSlug)}`;
    });

    $('#experience-form', wrap).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errEl = $('#experience-error', wrap);
      const btn = $('#btn-save-experience', wrap);
      errEl.hidden = true;

      const reviewLinks = {};
      $$('[data-review-link]', form).forEach((input) => {
        reviewLinks[input.dataset.reviewLink] = input.value.trim();
      });

      const delaySec = Number(form.thankYouRedirectDelaySec.value);
      const payload = {
        platforms: [...selected],
        reviewLinks,
        welcomeVideoUrl: form.welcomeVideoUrl.value.trim(),
        welcomeVideoPoster: form.welcomeVideoPoster.value.trim(),
        interviewQuestions: questions.map((q) => q.trim()).filter(Boolean),
        videoCaptureEnabled: form.videoCaptureEnabled.checked,
        thankYouUrl: form.thankYouUrl.value.trim(),
        thankYouRedirectDelayMs: Number.isFinite(delaySec) && delaySec >= 0 ? Math.round(delaySec * 1000) : 0,
        allowedRedirectHosts: form.allowedRedirectHosts.value
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        supportEmail: form.supportEmail.value.trim(),
      };

      btn.disabled = true;
      btn.textContent = 'Saving…';
      const res = await api('/api/configure/update-settings', {
        method: 'POST',
        body: { clientSlug: client.clientSlug, providerName: client.providerName, settings: payload },
      });
      if (!res.ok) {
        errEl.textContent = res.message || res.error || 'Save failed';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Save experience';
        return;
      }

      client.portalSettings = res.settings;
      client.settingsSource = 'store';
      const idx = appState.clients.findIndex((c) => c.clientSlug === client.clientSlug);
      if (idx >= 0) appState.clients[idx] = { ...appState.clients[idx], ...client };

      showFlash(
        res.configPatched
          ? `Saved experience for ${client.providerName} (store + config.js)`
          : `Saved experience for ${client.providerName}`,
        'ok',
      );
      btn.disabled = false;
      btn.textContent = 'Save experience';
    });

    return wrap;
  }

  function showQueryFlash() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) showFlash(params.get('error'), 'error');
    else if (params.get('warn')) showFlash(`Connected, but provision warned: ${params.get('warn')}`, 'warn');
    else if (params.get('connected')) showFlash(`Connected HubSpot for ${params.get('connected')}`, 'ok');
  }

  function showFlash(message, kind) {
    flashEl.hidden = false;
    flashEl.className = `cfg-flash ${kind}`;
    flashEl.textContent = message;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text }; }
    if (!res.ok) return { ok: false, ...data };
    return { ok: true, ...data };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }
})();
