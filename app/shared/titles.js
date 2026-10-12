import { PRODUCT_NAME, TITLE_SEPARATOR } from './brand.js';

// One title per screen in replica/recon.md. Ids are stable (S01...). Wording is original.
export const SCREEN_TITLES = {
  S01: 'Sign in',
  S02: 'Join your workspace',
  S03: 'My tasks',
  S04: 'List',
  S05: 'Board',
  S06: 'Calendar',
  S07: 'Timeline',
  S08: 'Task',
  S09: 'Project settings',
  S10: 'Form builder',
  S11: 'Request form',
  S12: 'Rules',
  S13: 'Project overview',
  S14: 'Dashboards',
  S15: 'Portfolios',
  S16: 'Goals',
  S17: 'Capacity',
  S18: 'Approvals',
  S19: 'Time',
  S20: 'Members',
  S21: 'Teams',
  S22: 'Single sign-on',
  S23: 'User provisioning',
  S24: 'Security',
  S25: 'Service accounts',
  S26: 'Branding and onboarding',
  S27: 'Workflow bundles',
  S28: 'Audit log',
  S29: 'Data and backup',
  S30: 'Integrations',
  S31: 'Support',
  S32: 'AI features (preview)',
  S33: 'Compliance documents (not certified)',
  S34: 'Mock identity provider',
  S35: 'Projects',
  S36: 'Account',
};

/** "Detail · Screen title · Product name". `detail` is optional (a project or task name). */
export function pageTitle(screenId, detail) {
  const title = SCREEN_TITLES[screenId];
  if (!title) throw new Error(`No page title for screen ${screenId}`);
  return [detail, title, PRODUCT_NAME].filter(Boolean).join(TITLE_SEPARATOR);
}

/** For the HTML shell, before any screen is chosen. */
export const DEFAULT_TITLE = PRODUCT_NAME;
