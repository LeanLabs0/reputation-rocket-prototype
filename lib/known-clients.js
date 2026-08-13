/**
 * Built-in client catalog for /configure.
 * HubSpot portal/form IDs here are defaults until OAuth provision overwrites the store.
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
    providerName: 'eImmigration',
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
];

function getKnownClient(clientSlug) {
  return KNOWN_CLIENTS.find((c) => c.clientSlug === clientSlug) || null;
}

module.exports = {
  KNOWN_CLIENTS,
  getKnownClient,
};
