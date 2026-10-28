(function () {
  const gate = document.getElementById('rr-clients-gate');
  const board = document.getElementById('rr-clients-board');
  const list = document.getElementById('rr-clients-list');
  const count = document.getElementById('rr-clients-count');
  const error = document.getElementById('rr-clients-error');
  const form = document.getElementById('rr-clients-form');

  function showError(message) {
    error.hidden = !message;
    error.textContent = message || '';
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function link(label, href, kind) {
    if (!href) return '<span class="rr-clients-missing">' + esc(label) + ' not set up</span>';
    const style = kind === 'primary' ? 'btn btn-primary' : 'btn btn-secondary';
    return '<a class="' + style + '" href="' + esc(href) + '">' + esc(label) + '</a>';
  }

  function logo(client) {
    if (!client.logoUrl) return '';
    return '<span class="rr-clients-logo">' +
      '<img src="' + esc(client.logoUrl) + '" alt="" decoding="async">' +
      '</span>';
  }

  function render(clients) {
    gate.hidden = true;
    board.hidden = false;
    count.textContent = clients.length + (clients.length === 1 ? ' client' : ' clients');
    list.innerHTML = clients.map((client) => (
      '<article class="rr-directory-card rr-clients-card">' +
        logo(client) +
        '<h2 class="rr-directory-card-name">' + esc(client.name) + '</h2>' +
        '<div class="rr-clients-actions">' +
          link('Open live page', client.liveUrl, 'primary') +
          link('Open demo page', client.demoUrl, 'secondary') +
        '</div>' +
      '</article>'
    )).join('');
  }

  async function loadCatalog() {
    const res = await fetch('/api/overdeliver/catalog', { credentials: 'same-origin' });
    if (res.status === 401) {
      gate.hidden = false;
      board.hidden = true;
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.detail || data.error || 'Could not load the directory.');
      return;
    }
    render(data.clients || []);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const password = document.getElementById('rr-clients-password').value;
    const res = await fetch('/api/overdeliver/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || 'Could not unlock.');
      return;
    }
    form.reset();
    await loadCatalog();
  });
})();
