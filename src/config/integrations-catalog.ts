import type { IntegrationCredentialKey } from './env';

/**
 * Integration Hub catalog (BRD 104-109).
 *
 * Connection status is NEVER faked. It is derived at request time from the
 * presence of the credentials named in `requiredEnvKeys`:
 *   no keys configured   -> "Not Connected"
 *   partially configured -> "Configuration Required"
 *   fully configured     -> "Connected" (subject to the last sync result)
 */

export interface IntegrationSpec {
  key: string;
  name: string;
  description: string;
  category: 'website' | 'marketing' | 'government' | 'accounting' | 'crm' | 'automation' | 'bi' | 'communication' | 'payments';
  /** Which system owns this data (BRD 109). */
  systemOfRecord: string;
  requiredEnvKeys: string[];
  /** Key in `integrationCredentials` used to evaluate readiness. */
  credentialKey: IntegrationCredentialKey | null;
  docsPath: string;
}

export const INTEGRATION_CATALOG: IntegrationSpec[] = [
  {
    key: 'website',
    name: 'RIFTARA Website',
    description: 'Publishes available units and receives website inquiries as CRM leads.',
    category: 'website',
    systemOfRecord: 'riftara',
    requiredEnvKeys: ['WEBSITE_WEBHOOK_SECRET'],
    credentialKey: 'website',
    docsPath: 'docs/API.md#website-integration',
  },
  {
    key: 'ejar',
    name: 'Ejar (Saudi Real Estate)',
    description: 'Registers lease contracts with the national Ejar platform.',
    category: 'government',
    systemOfRecord: 'ejar',
    requiredEnvKeys: ['EJAR_API_BASE_URL', 'EJAR_API_KEY'],
    credentialKey: 'ejar',
    docsPath: 'docs/API.md#ejar',
  },
  {
    key: 'payment_gateway',
    name: 'Payment Gateway',
    description: 'Accepts online rent and reservation payments and reconciles them automatically.',
    category: 'payments',
    systemOfRecord: 'gateway',
    requiredEnvKeys: ['PAYMENT_GATEWAY_BASE_URL', 'PAYMENT_GATEWAY_KEY'],
    credentialKey: 'paymentGateway',
    docsPath: 'docs/API.md#payments',
  },
  {
    key: 'erp',
    name: 'ERP / Accounting',
    description: 'Posts invoices, payments and operating expenses to the finance system of record.',
    category: 'accounting',
    systemOfRecord: 'erp',
    requiredEnvKeys: ['ERP_API_BASE_URL', 'ERP_API_KEY'],
    credentialKey: 'erp',
    docsPath: 'docs/API.md#erp',
  },
  {
    key: 'google_ads',
    name: 'Google Ads',
    description: 'Imports campaign spend and performance, and uploads offline conversions.',
    category: 'marketing',
    systemOfRecord: 'google',
    requiredEnvKeys: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'],
    credentialKey: 'googleAds',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'google_analytics',
    name: 'Google Analytics',
    description: 'Imports website sessions and landing-page attribution.',
    category: 'marketing',
    systemOfRecord: 'google',
    requiredEnvKeys: ['GOOGLE_ANALYTICS_PROPERTY_ID'],
    credentialKey: 'googleAnalytics',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'meta_ads',
    name: 'Meta Business (Facebook / Instagram)',
    description: 'Syncs campaign performance and receives Meta Lead Ads submissions.',
    category: 'marketing',
    systemOfRecord: 'meta',
    requiredEnvKeys: ['META_ADS_APP_ID', 'META_ADS_APP_SECRET'],
    credentialKey: 'metaAds',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'tiktok_ads',
    name: 'TikTok Ads',
    description: 'Syncs campaigns and imports TikTok Lead Generation form submissions.',
    category: 'marketing',
    systemOfRecord: 'tiktok',
    requiredEnvKeys: ['TIKTOK_ADS_APP_ID', 'TIKTOK_ADS_APP_SECRET'],
    credentialKey: 'tiktokAds',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'snapchat_ads',
    name: 'Snapchat Ads',
    description: 'Imports campaign spend, leads and attribution.',
    category: 'marketing',
    systemOfRecord: 'snapchat',
    requiredEnvKeys: ['SNAPCHAT_ADS_CLIENT_ID', 'SNAPCHAT_ADS_CLIENT_SECRET'],
    credentialKey: 'snapchatAds',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'linkedin_ads',
    name: 'LinkedIn Ads',
    description: 'Imports B2B campaign performance and LinkedIn Lead Gen forms.',
    category: 'marketing',
    systemOfRecord: 'linkedin',
    requiredEnvKeys: ['LINKEDIN_ADS_CLIENT_ID', 'LINKEDIN_ADS_CLIENT_SECRET'],
    credentialKey: 'linkedinAds',
    docsPath: 'docs/API.md#marketing',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Logs WhatsApp conversations against the customer timeline.',
    category: 'communication',
    systemOfRecord: 'riftara',
    requiredEnvKeys: ['WHATSAPP_API_BASE_URL', 'WHATSAPP_API_TOKEN'],
    credentialKey: 'whatsapp',
    docsPath: 'docs/API.md#communication',
  },
  {
    key: 'zoho',
    name: 'Zoho Suite',
    description: 'Two-way sync with Zoho CRM, Books, Analytics, Campaigns and Desk.',
    category: 'crm',
    systemOfRecord: 'riftara',
    requiredEnvKeys: ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'],
    credentialKey: 'zoho',
    docsPath: 'docs/API.md#crm',
  },
  {
    key: 'monday',
    name: 'monday.com',
    description: 'Mirrors leads and property tasks into monday.com boards.',
    category: 'automation',
    systemOfRecord: 'riftara',
    requiredEnvKeys: ['MONDAY_API_TOKEN'],
    credentialKey: 'monday',
    docsPath: 'docs/API.md#automation',
  },
  {
    key: 'smtp',
    name: 'Email (SMTP)',
    description: 'Sends notifications, proposals and scheduled management reports.',
    category: 'communication',
    systemOfRecord: 'riftara',
    requiredEnvKeys: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'],
    credentialKey: 'smtp',
    docsPath: 'docs/DEPLOYMENT.md#email',
  },
  {
    key: 'automation_webhooks',
    name: 'Make / Zapier / n8n',
    description:
      'Outbound webhooks for no-code automation. Configure targets under Integrations › Webhooks.',
    category: 'automation',
    systemOfRecord: 'riftara',
    requiredEnvKeys: [],
    credentialKey: null,
    docsPath: 'docs/API.md#webhooks',
  },
  {
    key: 'bi_export',
    name: 'BI Platforms (Power BI / Tableau / Looker)',
    description:
      'Read-only reporting API and scheduled exports for external business-intelligence tools.',
    category: 'bi',
    systemOfRecord: 'riftara',
    requiredEnvKeys: [],
    credentialKey: null,
    docsPath: 'docs/API.md#reporting',
  },
];

export const INTEGRATION_BY_KEY = new Map(INTEGRATION_CATALOG.map((i) => [i.key, i]));
