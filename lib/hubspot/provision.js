const FORM_NAME = '[LL] Reputation Rocket - Sign in';

const COMPLETE_PROPERTY = {
  name: 'rr_iscomplete',
  label: 'RR Is Complete',
  type: 'enumeration',
  fieldType: 'select',
  groupName: 'contactinformation',
  options: [
    { label: 'Yes', value: 'Yes', displayOrder: 0, hidden: false },
    { label: 'No', value: 'No', displayOrder: 1, hidden: false },
  ],
};

const OUTCOME_PROPERTY = {
  name: 'rr_outcome',
  label: 'RR Outcome',
  type: 'enumeration',
  fieldType: 'select',
  groupName: 'contactinformation',
  options: [
    { label: 'Positive', value: 'positive', displayOrder: 0, hidden: false },
    { label: 'Negative', value: 'negative', displayOrder: 1, hidden: false },
  ],
};

const FORM_FIELDS = [
  { name: 'firstname', label: 'First Name', fieldType: 'single_line_text', required: true },
  { name: 'lastname', label: 'Last Name', fieldType: 'single_line_text', required: true },
  { name: 'email', label: 'Email', fieldType: 'email', required: true },
  { name: 'company', label: 'Company Name', fieldType: 'single_line_text', required: true },
];

async function provisionPortal(accessToken) {
  const results = {
    properties: {},
    form: null,
  };

  results.properties.rr_iscomplete = await ensureContactProperty(accessToken, COMPLETE_PROPERTY);
  results.properties.rr_outcome = await ensureContactProperty(accessToken, OUTCOME_PROPERTY);
  try {
    results.form = await ensureLeadForm(accessToken);
  } catch (err) {
    err.partial = results;
    throw err;
  }

  return results;
}

async function ensureContactProperty(accessToken, definition) {
  const existing = await hubspotFetch(
    accessToken,
    `https://api.hubapi.com/crm/v3/properties/contacts/${definition.name}`,
    { method: 'GET', allowNotFound: true },
  );
  if (existing) {
    return { status: 'exists', name: definition.name };
  }

  await hubspotFetch(accessToken, 'https://api.hubapi.com/crm/v3/properties/contacts', {
    method: 'POST',
    body: definition,
  });
  return { status: 'created', name: definition.name };
}

function buildFormField(field) {
  const base = {
    objectTypeId: '0-1',
    name: field.name,
    label: field.label,
    required: field.required,
    hidden: false,
    fieldType: field.fieldType,
    dependentFields: [],
  };

  // Email fields require a validation object (HubSpot Forms v3).
  if (field.fieldType === 'email') {
    base.validation = {
      blockedEmailDomains: [],
      useDefaultBlockList: false,
    };
  }

  return base;
}

function buildCreateFormBody() {
  // HubSpot's OpenAPI schema marks createdAt/updatedAt/archived as required on create.
  const now = new Date().toISOString();
  return {
    name: FORM_NAME,
    formType: 'hubspot',
    createdAt: now,
    updatedAt: now,
    archived: false,
    fieldGroups: FORM_FIELDS.map((field) => ({
      groupType: 'default_group',
      richTextType: 'text',
      fields: [buildFormField(field)],
    })),
    configuration: {
      language: 'en',
      cloneable: true,
      editable: true,
      archivable: true,
      createNewContactForNewEmail: true,
      allowLinkToResetKnownValues: true,
      lifecycleStages: [],
      postSubmitAction: {
        type: 'thank_you',
        value: 'Thanks — you can close this window.',
      },
      prePopulateKnownValues: true,
      notifyContactOwner: false,
      notifyRecipients: [],
      recaptchaEnabled: false,
    },
    displayOptions: {
      renderRawHtml: false,
      theme: 'default_style',
      submitButtonText: 'Start my review',
      style: {
        backgroundWidth: '100%',
        fontFamily: 'arial, helvetica, sans-serif',
        helpTextColor: '#7C98B6',
        helpTextSize: '11px',
        labelTextColor: '#33475b',
        labelTextSize: '13px',
        legalConsentTextColor: '#33475b',
        legalConsentTextSize: '14px',
        submitAlignment: 'left',
        submitColor: '#ff7a59',
        submitFontColor: '#ffffff',
        submitSize: '12px',
      },
    },
    legalConsentOptions: {
      type: 'none',
    },
  };
}

async function ensureLeadForm(accessToken) {
  const forms = await listForms(accessToken);
  const match = forms.find((f) => String(f.name || '').trim() === FORM_NAME);
  if (match) {
    return {
      status: 'exists',
      id: match.id,
      name: match.name,
    };
  }

  const created = await hubspotFetch(accessToken, 'https://api.hubapi.com/marketing/v3/forms/', {
    method: 'POST',
    body: buildCreateFormBody(),
  });

  return {
    status: 'created',
    id: created.id,
    name: created.name || FORM_NAME,
  };
}

async function listForms(accessToken) {
  const out = [];
  let after;
  do {
    const url = new URL('https://api.hubapi.com/marketing/v3/forms/');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const page = await hubspotFetch(accessToken, url.toString(), { method: 'GET' });
    out.push(...(page.results || []));
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

async function deleteContactProperty(accessToken, propertyName) {
  const existing = await hubspotFetch(
    accessToken,
    `https://api.hubapi.com/crm/v3/properties/contacts/${propertyName}`,
    { method: 'GET', allowNotFound: true },
  );
  if (!existing) {
    return { status: 'missing', name: propertyName };
  }

  await hubspotFetch(
    accessToken,
    `https://api.hubapi.com/crm/v3/properties/contacts/${propertyName}`,
    { method: 'DELETE', allowNotFound: true },
  );
  return { status: 'deleted', name: propertyName };
}

async function archiveLeadForm(accessToken, { formId = '', formName = FORM_NAME } = {}) {
  let id = String(formId || '').trim();
  if (!id) {
    const forms = await listForms(accessToken);
    const match = forms.find((f) => String(f.name || '').trim() === formName);
    id = match?.id || '';
  }
  if (!id) {
    return { status: 'missing', id: '', name: formName };
  }

  await hubspotFetch(
    accessToken,
    `https://api.hubapi.com/marketing/v3/forms/${encodeURIComponent(id)}`,
    { method: 'DELETE', allowNotFound: true },
  );
  return { status: 'archived', id, name: formName };
}

/**
 * Remove Reputation Rocket HubSpot artifacts from a portal.
 * Archives the sign-in form and deletes rr_iscomplete / rr_outcome.
 */
async function deprovisionPortal(accessToken, { formId = '' } = {}) {
  const results = {
    properties: {},
    form: null,
    errors: [],
  };

  for (const name of [COMPLETE_PROPERTY.name, OUTCOME_PROPERTY.name]) {
    try {
      results.properties[name] = await deleteContactProperty(accessToken, name);
    } catch (err) {
      results.properties[name] = { status: 'error', name, message: err.message };
      results.errors.push(`property ${name}: ${err.message}`);
    }
  }

  try {
    results.form = await archiveLeadForm(accessToken, { formId, formName: FORM_NAME });
  } catch (err) {
    results.form = { status: 'error', message: err.message };
    results.errors.push(`form: ${err.message}`);
  }

  if (results.errors.length) {
    const err = new Error(results.errors.join('; '));
    err.partial = results;
    throw err;
  }

  return results;
}

async function hubspotFetch(accessToken, url, { method = 'GET', body, allowNotFound = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (allowNotFound && res.status === 404) return null;
  if (res.status === 204) return null;

  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) { /* not JSON */ }

  if (!res.ok) {
    const msg = payload.message || payload.error || text || res.statusText;
    throw new Error(`${method} ${url} → ${res.status}: ${msg}`);
  }
  return payload;
}

module.exports = {
  FORM_NAME,
  FORM_FIELDS,
  COMPLETE_PROPERTY,
  OUTCOME_PROPERTY,
  provisionPortal,
  deprovisionPortal,
  buildCreateFormBody,
};
