/**
 * Built-in client catalog for /configure.
 * HubSpot portal/form IDs here are defaults until OAuth provision overwrites the store.
 * Dynamic clients created via /configure are merged from the install store.
 */
const KNOWN_CLIENTS = [
  {
    clientSlug: 'lean-labs',
    providerName: 'Lean Labs',
    portalPath: '/lean-labs/',
    defaultPortalId: '275827',
    defaultFormId: '102ade8e-7204-41f9-80a0-6a5808c71089',
    defaultFormRegion: 'na1',
  },
  {
    clientSlug: 'eimmigration',
    providerName: 'eimmigration',
    portalPath: '/eimmigration/',
    defaultPortalId: '45248900',
    defaultFormId: 'd636fadd-2e72-4663-bf26-e465c7d419a5',
    defaultFormRegion: 'na1',
  },
  {
    clientSlug: 'propertyradar',
    providerName: 'PropertyRadar',
    portalPath: '/propertyradar/',
    defaultPortalId: '',
    defaultFormId: '',
    defaultFormRegion: 'na1',
  },
  {
    clientSlug: 'greentec',
    providerName: 'Greentec',
    portalPath: '/greentec/',
    defaultPortalId: '',
    defaultFormId: '',
    defaultFormRegion: 'na1',
  },
];

function getKnownClient(clientSlug) {
  return KNOWN_CLIENTS.find((c) => c.clientSlug === clientSlug) || null;
}

async function resolveClient(clientSlug) {
  const known = getKnownClient(clientSlug);
  if (known) return known;

  const { getClient } = require('./hubspot/store');
  const stored = await getClient(clientSlug);
  if (!stored) return null;

  return {
    clientSlug,
    providerName: stored.providerName || clientSlug,
    portalPath: stored.portalPath || `/${clientSlug}/`,
    defaultPortalId: stored.portalId || '',
    defaultFormId: stored.formId || '',
    defaultFormRegion: stored.formRegion || 'na1',
  };
}

async function listAllClients() {
  const { listClients, publicClient } = require('./hubspot/store');
  const stored = await listClients();
  const bySlug = new Map();

  for (const known of KNOWN_CLIENTS) {
    bySlug.set(known.clientSlug, { ...known });
  }

  for (const [slug, record] of Object.entries(stored || {})) {
    const pub = publicClient(record);
    const existing = bySlug.get(slug) || {
      clientSlug: slug,
      providerName: record.providerName || slug,
      portalPath: record.portalPath || `/${slug}/`,
      defaultPortalId: '',
      defaultFormId: '',
      defaultFormRegion: 'na1',
    };
    bySlug.set(slug, {
      ...existing,
      providerName: record.providerName || existing.providerName,
      portalPath: record.portalPath || existing.portalPath,
      _store: pub,
    });
  }

  return [...bySlug.values()];
}

module.exports = {
  KNOWN_CLIENTS,
  getKnownClient,
  resolveClient,
  listAllClients,
};
