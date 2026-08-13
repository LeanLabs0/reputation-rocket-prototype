(async function () {
  const $ = (sel) => document.querySelector(sel);
  const loginPanel = $('#login-panel');
  const setupPanel = $('#setup-panel');
  const appPanel = $('#app-panel');
  const clientsEl = $('#clients');
  const logoutBtn = $('#btn-logout');
  const flashEl = $('#flash');
  const loginError = $('#login-error');

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

  renderApp(status);
  logoutBtn.hidden = false;
  logoutBtn.addEventListener('click', onLogout);

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

  function renderApp(data) {
    appPanel.hidden = false;
    $('#storage-mode').textContent = `storage: ${data.storage?.mode || 'unknown'}`;
    clientsEl.innerHTML = '';
    (data.clients || []).forEach((client) => {
      clientsEl.appendChild(renderClientCard(client));
    });
  }

  function renderClientCard(client) {
    const el = document.createElement('article');
    el.className = 'cfg-client';
    const connected = Boolean(client.connected);
    const provisioned = Boolean(client.provisionedAt && client.formId);
    const propsOk = Boolean(client.properties?.rr_iscomplete && client.properties?.rr_outcome);

    el.innerHTML = `
      <div class="cfg-client-top">
        <div>
          <h3>${escapeHtml(client.providerName)}</h3>
          <p class="cfg-muted"><a href="${escapeHtml(client.portalPath)}" style="color:inherit">${escapeHtml(client.portalPath)}</a> · <span class="cfg-code">${escapeHtml(client.clientSlug)}</span></p>
        </div>
        <div class="cfg-actions">
          <button type="button" class="cfg-btn cfg-btn-primary" data-action="connect">${connected ? 'Reconnect HubSpot' : 'Connect HubSpot'}</button>
          <button type="button" class="cfg-btn cfg-btn-success" data-action="provision" ${connected || client.hasEnvPat ? '' : 'disabled'}>Run HubSpot setup</button>
        </div>
      </div>
      <ul class="cfg-checklist">
        <li><span class="cfg-dot ${connected ? 'ok' : 'bad'}"></span><span>OAuth connected ${connected ? '' : '(or use env PAT fallback)'}</span></li>
        <li><span class="cfg-dot ${client.hasEnvPat ? 'ok' : 'warn'}"></span><span>Env PAT fallback ${client.hasEnvPat ? 'present' : 'not set'}</span></li>
        <li><span class="cfg-dot ${propsOk ? 'ok' : 'warn'}"></span><span>Properties rr_iscomplete + rr_outcome</span></li>
        <li><span class="cfg-dot ${provisioned ? 'ok' : 'warn'}"></span><span>Form “[LL] Reputation Rocket - Sign in” ${client.formId ? `· ${escapeHtml(client.formId)}` : ''}</span></li>
        <li><span class="cfg-dot ${client.portalId ? 'ok' : 'bad'}"></span><span>Portal ID: <span class="cfg-code">${escapeHtml(client.portalId || '—')}</span></span></li>
      </ul>
      <p class="cfg-muted" style="margin-top:12px">Still manual: Slack channel + thread TS, review links, brand CSS.</p>
      <p class="cfg-muted">Put in client <code>config.js</code> after provision:</p>
      <pre class="cfg-code" style="margin:8px 0 0; white-space:pre-wrap">hubspotPortalId: '${escapeHtml(client.portalId || '')}',
hubspotFormId: '${escapeHtml(client.formId || '')}',
hubspotFormRegion: '${escapeHtml(client.formRegion || 'na1')}',
hubspotCompleteProperty: 'rr_iscomplete',
hubspotCompleteValue: 'Yes',
hubspotOutcomeProperty: 'rr_outcome',
hubspotOutcomePositiveValue: 'positive',
hubspotOutcomeNegativeValue: 'negative',</pre>
    `;

    el.querySelector('[data-action="connect"]').addEventListener('click', async () => {
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

    el.querySelector('[data-action="provision"]').addEventListener('click', async (btnEv) => {
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
      window.location.reload();
    });

    return el;
  }

  function showQueryFlash() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) showFlash(params.get('error'), 'error');
    else if (params.get('warn')) showFlash(`Connected, but provision warned: ${params.get('warn')}`, 'warn');
    else if (params.get('connected')) showFlash(`Connected HubSpot for ${params.get('connected')}`, 'ok');
    if ([...params.keys()].length) {
      window.history.replaceState({}, '', window.location.pathname);
    }
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
})();
