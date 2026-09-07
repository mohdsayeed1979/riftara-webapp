import { env } from '@/config/env';
import { PERMISSIONS, ROLE_DEFINITIONS, resolveRolePermissions } from '@/lib/permissions/catalog';
import { hashPassword } from '@/lib/auth/password';
import type { Database } from '../types';
import {
  cities,
  districts,
  documentCategories,
  expenseCategories,
  integrations,
  kpiDefinitions,
  kpiThresholds,
  leadSources,
  leadStages,
  lossReasons,
  maintenanceCategories,
  marketingPlatforms,
  organizations,
  permissions as permissionsTable,
  portfolios,
  propertyTypes,
  regions,
  rolePermissions,
  roles,
  savedViews,
  settings,
  unitStatuses,
  unitTypes,
  userRoles,
  users,
  vendors,
  businessRuleConfigs,
} from '../schema';
import { KPI_DICTIONARY } from '@/lib/calculations/kpi-dictionary';
import { DEFAULT_SETTINGS } from '@/config/settings-defaults';
import { INTEGRATION_CATALOG } from '@/config/integrations-catalog';
import { BUSINESS_RULES } from '@/config/business-rules';

export interface ReferenceData {
  organizationId: string;
  portfolioId: string;
  regionIds: Record<string, string>;
  cityIds: Record<string, string>;
  districtIds: Record<string, string>;
  propertyTypeIds: Record<string, string>;
  unitTypeIds: Record<string, string>;
  unitStatusIds: Record<string, string>;
  leadStageIds: Record<string, string>;
  leadSourceIds: Record<string, string>;
  lossReasonIds: Record<string, string>;
  expenseCategoryIds: Record<string, string>;
  maintenanceCategoryIds: Record<string, string>;
  vendorIds: Record<string, string>;
  marketingPlatformIds: Record<string, string>;
  userIds: Record<string, string>;
  roleIds: Record<string, string>;
}

const REGIONS = [
  { key: 'central', en: 'Central Region', ar: 'المنطقة الوسطى' },
  { key: 'western', en: 'Western Region', ar: 'المنطقة الغربية' },
  { key: 'eastern', en: 'Eastern Region', ar: 'المنطقة الشرقية' },
];

const CITIES = [
  { key: 'riyadh', region: 'central', en: 'Riyadh', ar: 'الرياض', lat: 24.7136, lng: 46.6753 },
  { key: 'jeddah', region: 'western', en: 'Jeddah', ar: 'جدة', lat: 21.4858, lng: 39.1925 },
  { key: 'dammam', region: 'eastern', en: 'Dammam', ar: 'الدمام', lat: 26.4207, lng: 50.0888 },
  { key: 'khobar', region: 'eastern', en: 'Al Khobar', ar: 'الخبر', lat: 26.2794, lng: 50.208 },
];

const DISTRICTS = [
  { key: 'al_yarmouk', city: 'riyadh', en: 'Al Yarmouk', ar: 'اليرموك', lat: 24.8, lng: 46.79 },
  { key: 'al_aqeeq', city: 'riyadh', en: 'Al Aqeeq', ar: 'العقيق', lat: 24.766, lng: 46.63 },
  { key: 'granata', city: 'riyadh', en: 'Granada', ar: 'غرناطة', lat: 24.767, lng: 46.75 },
  { key: 'al_olaya', city: 'riyadh', en: 'Al Olaya', ar: 'العليا', lat: 24.69, lng: 46.685 },
  { key: 'al_rawdah', city: 'jeddah', en: 'Al Rawdah', ar: 'الروضة', lat: 21.57, lng: 39.16 },
  { key: 'al_shatea', city: 'jeddah', en: 'Al Shatea', ar: 'الشاطئ', lat: 21.64, lng: 39.11 },
  {
    key: 'second_industrial',
    city: 'dammam',
    en: 'Second Industrial City',
    ar: 'المدينة الصناعية الثانية',
    lat: 26.36,
    lng: 50.06,
  },
  { key: 'al_aqrabiyah', city: 'khobar', en: 'Al Aqrabiyah', ar: 'العقربية', lat: 26.3, lng: 50.2 },
];

const PROPERTY_TYPES = [
  { key: 'office_building', en: 'Office Building', ar: 'مبنى مكاتب', category: 'commercial' },
  { key: 'commercial_building', en: 'Commercial Building', ar: 'مبنى تجاري', category: 'commercial' },
  { key: 'shopping_center', en: 'Shopping Center', ar: 'مركز تسوق', category: 'commercial' },
  { key: 'warehouse', en: 'Warehouse', ar: 'مستودع', category: 'commercial' },
  { key: 'logistics_asset', en: 'Logistics Asset', ar: 'أصل لوجستي', category: 'commercial' },
  { key: 'residential_building', en: 'Residential Building', ar: 'مبنى سكني', category: 'residential' },
  { key: 'residential_compound', en: 'Residential Compound', ar: 'مجمع سكني', category: 'residential' },
  { key: 'villa', en: 'Villa', ar: 'فيلا', category: 'residential' },
  { key: 'apartment_building', en: 'Apartment Building', ar: 'عمارة سكنية', category: 'residential' },
  { key: 'mixed_use', en: 'Mixed-Use Project', ar: 'مشروع متعدد الاستخدامات', category: 'mixed' },
  { key: 'land', en: 'Land', ar: 'أرض', category: 'land' },
  { key: 'staff_accommodation', en: 'Staff Accommodation', ar: 'سكن موظفين', category: 'residential' },
  { key: 'hospitality', en: 'Hospitality Asset', ar: 'أصل ضيافة', category: 'specialised' },
  { key: 'parking_asset', en: 'Parking Asset', ar: 'أصل مواقف', category: 'specialised' },
  { key: 'advertising_space', en: 'Advertising Space', ar: 'مساحة إعلانية', category: 'specialised' },
  { key: 'telecom_site', en: 'Telecommunications Site', ar: 'موقع اتصالات', category: 'specialised' },
  { key: 'atm_site', en: 'ATM Site', ar: 'موقع صراف آلي', category: 'specialised' },
  { key: 'kiosk', en: 'Kiosk', ar: 'كشك', category: 'specialised' },
  { key: 'storage_area', en: 'Storage Area', ar: 'منطقة تخزين', category: 'specialised' },
];

const UNIT_TYPES = [
  { key: 'office_small', en: 'Office — Small', ar: 'مكتب صغير', category: 'commercial' },
  { key: 'office_medium', en: 'Office — Medium', ar: 'مكتب متوسط', category: 'commercial' },
  { key: 'office_large', en: 'Office — Large', ar: 'مكتب كبير', category: 'commercial' },
  { key: 'retail_shop', en: 'Retail Shop', ar: 'محل تجاري', category: 'commercial' },
  { key: 'showroom', en: 'Showroom', ar: 'معرض', category: 'commercial' },
  { key: 'warehouse_unit', en: 'Warehouse Unit', ar: 'وحدة مستودع', category: 'commercial' },
  { key: 'kiosk_unit', en: 'Kiosk', ar: 'كشك', category: 'commercial' },
  { key: 'apartment_1br', en: 'Apartment — 1 Bedroom', ar: 'شقة غرفة نوم', category: 'residential' },
  { key: 'apartment_2br', en: 'Apartment — 2 Bedrooms', ar: 'شقة غرفتي نوم', category: 'residential' },
  { key: 'apartment_3br', en: 'Apartment — 3 Bedrooms', ar: 'شقة ثلاث غرف', category: 'residential' },
  { key: 'villa_unit', en: 'Villa', ar: 'فيلا', category: 'residential' },
  { key: 'parking_bay', en: 'Parking Bay', ar: 'موقف سيارة', category: 'specialised' },
  { key: 'storage_unit', en: 'Storage Unit', ar: 'وحدة تخزين', category: 'specialised' },
];

/** BRD 13 — every status, classified for the availability engine and KPIs. */
const UNIT_STATUSES = [
  {
    key: 'available',
    en: 'Available',
    ar: 'متاحة',
    availabilityClass: 'available',
    colorToken: 'available',
    publishable: true,
    countsAsOccupied: false,
    blocksLeasing: false,
  },
  {
    key: 'available_soon',
    en: 'Available Soon',
    ar: 'متاحة قريباً',
    availabilityClass: 'available',
    colorToken: 'available',
    publishable: true,
    countsAsOccupied: true,
    blocksLeasing: false,
  },
  {
    key: 'under_negotiation',
    en: 'Under Negotiation',
    ar: 'قيد التفاوض',
    availabilityClass: 'reserved',
    colorToken: 'reserved',
    publishable: true,
    countsAsOccupied: false,
    blocksLeasing: false,
  },
  {
    key: 'reserved',
    en: 'Reserved',
    ar: 'محجوزة',
    availabilityClass: 'reserved',
    colorToken: 'reserved',
    publishable: false,
    countsAsOccupied: true,
    blocksLeasing: true,
  },
  {
    key: 'pending_approval',
    en: 'Pending Approval',
    ar: 'بانتظار الاعتماد',
    availabilityClass: 'reserved',
    colorToken: 'reserved',
    publishable: false,
    countsAsOccupied: false,
    blocksLeasing: true,
  },
  {
    key: 'contract_preparation',
    en: 'Contract Preparation',
    ar: 'إعداد العقد',
    availabilityClass: 'reserved',
    colorToken: 'reserved',
    publishable: false,
    countsAsOccupied: true,
    blocksLeasing: true,
  },
  {
    key: 'leased',
    en: 'Leased',
    ar: 'مؤجرة',
    availabilityClass: 'leased',
    colorToken: 'leased',
    publishable: false,
    countsAsOccupied: true,
    blocksLeasing: true,
  },
  {
    key: 'occupied',
    en: 'Occupied',
    ar: 'مشغولة',
    availabilityClass: 'leased',
    colorToken: 'leased',
    publishable: false,
    countsAsOccupied: true,
    blocksLeasing: true,
  },
  {
    key: 'notice_received',
    en: 'Notice Received',
    ar: 'تم استلام إشعار',
    availabilityClass: 'leased',
    colorToken: 'reserved',
    publishable: true,
    countsAsOccupied: true,
    blocksLeasing: false,
  },
  {
    key: 'under_maintenance',
    en: 'Under Maintenance',
    ar: 'تحت الصيانة',
    availabilityClass: 'not_available',
    colorToken: 'maintenance',
    publishable: false,
    countsAsOccupied: false,
    blocksLeasing: true,
  },
  {
    key: 'under_renovation',
    en: 'Under Renovation',
    ar: 'تحت التجديد',
    availabilityClass: 'not_available',
    colorToken: 'maintenance',
    publishable: false,
    countsAsOccupied: false,
    blocksLeasing: true,
  },
  {
    key: 'blocked',
    en: 'Blocked',
    ar: 'محجوبة',
    availabilityClass: 'not_available',
    colorToken: 'blocked',
    publishable: false,
    countsAsOccupied: false,
    blocksLeasing: true,
  },
  {
    key: 'off_market',
    en: 'Off Market',
    ar: 'خارج السوق',
    availabilityClass: 'not_available',
    colorToken: 'blocked',
    publishable: false,
    countsAsOccupied: false,
    blocksLeasing: true,
  },
  {
    key: 'reservation_expired',
    en: 'Reservation Expired',
    ar: 'انتهى الحجز',
    availabilityClass: 'available',
    colorToken: 'available',
    publishable: true,
    countsAsOccupied: false,
    blocksLeasing: false,
  },
];

/** BRD 19 — the full leasing pipeline. */
const LEAD_STAGES = [
  { key: 'new_lead', en: 'New Inquiry', ar: 'استفسار جديد', type: 'open', prob: 5, color: 'info' },
  { key: 'contact_attempted', en: 'Contact Attempted', ar: 'محاولة تواصل', type: 'open', prob: 10, color: 'info' },
  { key: 'contacted', en: 'Contacted', ar: 'تم التواصل', type: 'open', prob: 15, color: 'info' },
  { key: 'qualified', en: 'Qualified', ar: 'مؤهل', type: 'open', prob: 25, color: 'info' },
  { key: 'viewing_scheduled', en: 'Viewing Scheduled', ar: 'تم جدولة معاينة', type: 'open', prob: 35, color: 'warning' },
  { key: 'viewing_completed', en: 'Viewing Completed', ar: 'تمت المعاينة', type: 'open', prob: 45, color: 'warning' },
  { key: 'negotiation', en: 'Negotiation', ar: 'تفاوض', type: 'open', prob: 55, color: 'warning' },
  { key: 'proposal_issued', en: 'Proposal Issued', ar: 'تم إصدار عرض', type: 'open', prob: 65, color: 'gold' },
  { key: 'pending_approval', en: 'Pending Approval', ar: 'بانتظار الاعتماد', type: 'open', prob: 70, color: 'gold' },
  { key: 'approved', en: 'Approved', ar: 'معتمد', type: 'open', prob: 80, color: 'gold' },
  { key: 'reserved', en: 'Reserved', ar: 'محجوز', type: 'open', prob: 88, color: 'gold' },
  { key: 'contract_preparation', en: 'Contract Preparation', ar: 'إعداد العقد', type: 'open', prob: 92, color: 'success' },
  { key: 'contract_issued', en: 'Contract Issued', ar: 'تم إصدار العقد', type: 'open', prob: 95, color: 'success' },
  { key: 'contract_signed', en: 'Contract Signed', ar: 'تم توقيع العقد', type: 'open', prob: 98, color: 'success' },
  { key: 'won', en: 'Closed Won', ar: 'مكتسب', type: 'won', prob: 100, color: 'success' },
  { key: 'lost', en: 'Closed Lost', ar: 'خاسر', type: 'lost', prob: 0, color: 'error' },
];

/** BRD 23 — configurable lead sources. */
const LEAD_SOURCES = [
  { key: 'corporate_website', en: 'Corporate Website', ar: 'الموقع الإلكتروني', channel: 'direct', platform: 'website' },
  { key: 'google', en: 'Google', ar: 'جوجل', channel: 'digital', platform: 'google' },
  { key: 'google_ads', en: 'Google Ads', ar: 'إعلانات جوجل', channel: 'digital', platform: 'google' },
  { key: 'instagram', en: 'Instagram', ar: 'إنستغرام', channel: 'digital', platform: 'meta' },
  { key: 'facebook', en: 'Facebook', ar: 'فيسبوك', channel: 'digital', platform: 'meta' },
  { key: 'snapchat', en: 'Snapchat', ar: 'سناب شات', channel: 'digital', platform: 'snapchat' },
  { key: 'tiktok', en: 'TikTok', ar: 'تيك توك', channel: 'digital', platform: 'tiktok' },
  { key: 'linkedin', en: 'LinkedIn', ar: 'لينكد إن', channel: 'digital', platform: 'linkedin' },
  { key: 'whatsapp', en: 'WhatsApp', ar: 'واتساب', channel: 'direct', platform: null },
  { key: 'call_center', en: 'Call Center', ar: 'مركز الاتصال', channel: 'offline', platform: null },
  { key: 'walk_in', en: 'Walk-In', ar: 'زيارة مباشرة', channel: 'offline', platform: null },
  { key: 'referral', en: 'Referral', ar: 'ترشيح', channel: 'referral', platform: null },
  { key: 'broker', en: 'Broker', ar: 'وسيط', channel: 'referral', platform: null },
  { key: 'aqar', en: 'Aqar', ar: 'عقار', channel: 'portal', platform: null },
  { key: 'bayut', en: 'Bayut', ar: 'بيوت', channel: 'portal', platform: null },
  { key: 'property_finder', en: 'Property Finder', ar: 'بروبرتي فايندر', channel: 'portal', platform: null },
  { key: 'employee_referral', en: 'Employee Referral', ar: 'ترشيح موظف', channel: 'referral', platform: null },
  { key: 'other', en: 'Other', ar: 'أخرى', channel: 'offline', platform: null },
];

const LOSS_REASONS = [
  { key: 'price_too_high', en: 'Price too high', ar: 'السعر مرتفع' },
  { key: 'unit_unavailable', en: 'Required unit unavailable', ar: 'الوحدة المطلوبة غير متاحة' },
  { key: 'location_unsuitable', en: 'Location unsuitable', ar: 'الموقع غير مناسب' },
  { key: 'area_unsuitable', en: 'Area unsuitable', ar: 'المساحة غير مناسبة' },
  { key: 'chose_competitor', en: 'Chose a competitor', ar: 'اختار منافساً' },
  { key: 'budget_withdrawn', en: 'Budget withdrawn', ar: 'سحب الميزانية' },
  { key: 'no_response', en: 'No response from customer', ar: 'لا يوجد رد من العميل' },
  { key: 'timing_mismatch', en: 'Timing mismatch', ar: 'عدم توافق التوقيت' },
];

const EXPENSE_CATEGORIES = [
  { key: 'maintenance', en: 'Maintenance', ar: 'الصيانة', opex: true, recoverable: true },
  { key: 'security', en: 'Security', ar: 'الأمن', opex: true, recoverable: true },
  { key: 'cleaning', en: 'Cleaning', ar: 'النظافة', opex: true, recoverable: true },
  { key: 'utilities', en: 'Utilities', ar: 'المرافق', opex: true, recoverable: true },
  { key: 'landscaping', en: 'Landscaping', ar: 'تنسيق الحدائق', opex: true, recoverable: true },
  { key: 'facility_management', en: 'Facility Management', ar: 'إدارة المرافق', opex: true, recoverable: true },
  { key: 'insurance', en: 'Insurance', ar: 'التأمين', opex: true, recoverable: false },
  { key: 'property_management', en: 'Property Management', ar: 'إدارة الأملاك', opex: true, recoverable: false },
  { key: 'municipality', en: 'Municipality Charges', ar: 'رسوم البلدية', opex: true, recoverable: false },
  { key: 'common_area', en: 'Common Area Expenses', ar: 'مصاريف المناطق المشتركة', opex: true, recoverable: true },
  { key: 'other_opex', en: 'Other OPEX', ar: 'مصاريف تشغيلية أخرى', opex: true, recoverable: false },
];

const MAINTENANCE_CATEGORIES = [
  { key: 'hvac', en: 'HVAC', ar: 'التكييف', response: 4, resolution: 24 },
  { key: 'electrical', en: 'Electrical', ar: 'الكهرباء', response: 2, resolution: 12 },
  { key: 'plumbing', en: 'Plumbing', ar: 'السباكة', response: 4, resolution: 24 },
  { key: 'elevators', en: 'Elevators', ar: 'المصاعد', response: 2, resolution: 8 },
  { key: 'fire_safety', en: 'Fire Safety', ar: 'السلامة من الحريق', response: 1, resolution: 8 },
  { key: 'civil', en: 'Civil & Finishing', ar: 'الأعمال المدنية والتشطيبات', response: 24, resolution: 96 },
  { key: 'painting', en: 'Painting', ar: 'الدهان', response: 48, resolution: 120 },
  { key: 'cctv_access', en: 'CCTV & Access Control', ar: 'المراقبة والتحكم بالدخول', response: 8, resolution: 48 },
  { key: 'generator', en: 'Generator', ar: 'المولد', response: 2, resolution: 12 },
  { key: 'pumps', en: 'Pumps', ar: 'المضخات', response: 4, resolution: 24 },
  { key: 'cleaning_request', en: 'Cleaning Request', ar: 'طلب نظافة', response: 8, resolution: 24 },
  { key: 'other', en: 'Other', ar: 'أخرى', response: 24, resolution: 72 },
];

const VENDORS = [
  { key: 'riftara_facilities', en: 'RIFTARA Facilities Management', cr: '1010234567', sla: 98, rating: 48 },
  { key: 'national_maintenance', en: 'National Maintenance Co.', cr: '1010345678', sla: 95, rating: 45 },
  { key: 'expert_hvac', en: 'Expert HVAC Services', cr: '1010456789', sla: 94, rating: 42 },
  { key: 'proclean', en: 'ProClean Services', cr: '1010567890', sla: 100, rating: 46 },
  { key: 'safelift', en: 'SafeLift Elevators', cr: '1010678901', sla: 92, rating: 41 },
  { key: 'gulf_power', en: 'Gulf Power Systems', cr: '1010789012', sla: 90, rating: 40 },
  { key: 'secure_watch', en: 'SecureWatch Security', cr: '1010890123', sla: 96, rating: 44 },
];

const MARKETING_PLATFORMS = [
  { key: 'google', name: 'Google Ads', category: 'search', color: '#4285F4', leadForms: true, conversions: true },
  { key: 'meta', name: 'Meta Business', category: 'social', color: '#0866FF', leadForms: true, conversions: true },
  { key: 'tiktok', name: 'TikTok Ads', category: 'social', color: '#010101', leadForms: true, conversions: true },
  { key: 'linkedin', name: 'LinkedIn Ads', category: 'social', color: '#0A66C2', leadForms: true, conversions: true },
  { key: 'snapchat', name: 'Snapchat Ads', category: 'social', color: '#FFFC00', leadForms: true, conversions: true },
  { key: 'website', name: 'RIFTARA Website', category: 'other', color: '#C9A96A', leadForms: true, conversions: false },
];

const DOCUMENT_CATEGORIES = [
  { key: 'ownership_document', en: 'Ownership Document', ar: 'وثيقة ملكية', applies: ['property'], expiry: false },
  { key: 'title_deed', en: 'Title Deed', ar: 'صك ملكية', applies: ['property'], expiry: false },
  { key: 'lease_agreement', en: 'Lease Agreement', ar: 'عقد إيجار', applies: ['contract'], expiry: true },
  { key: 'floor_plan', en: 'Floor Plan', ar: 'مخطط طابقي', applies: ['property', 'unit', 'building'], expiry: false },
  { key: 'property_image', en: 'Property Image', ar: 'صورة عقار', applies: ['property', 'unit'], expiry: false },
  { key: 'brochure', en: 'Brochure', ar: 'كتيب', applies: ['property'], expiry: false },
  { key: 'insurance_policy', en: 'Insurance Policy', ar: 'وثيقة تأمين', applies: ['property'], expiry: true },
  { key: 'valuation_report', en: 'Valuation Report', ar: 'تقرير تقييم', applies: ['property'], expiry: false },
  { key: 'municipality_license', en: 'Municipality License', ar: 'رخصة بلدية', applies: ['property'], expiry: true },
  { key: 'commercial_registration', en: 'Commercial Registration', ar: 'سجل تجاري', applies: ['customer', 'tenant'], expiry: true },
  { key: 'identification', en: 'Identification', ar: 'إثبات هوية', applies: ['customer', 'tenant'], expiry: true },
  { key: 'maintenance_contract', en: 'Maintenance Contract', ar: 'عقد صيانة', applies: ['property'], expiry: true },
  { key: 'handover_report', en: 'Handover Report', ar: 'محضر تسليم', applies: ['contract', 'unit'], expiry: false },
  { key: 'proposal_document', en: 'Leasing Proposal', ar: 'عرض تأجير', applies: ['proposal'], expiry: false },
  { key: 'management_report', en: 'Management Report', ar: 'تقرير إداري', applies: ['report'], expiry: false },
];

/** Demo staff. Every named role in the BRD is represented. */
const STAFF = [
  { email: 'sayeed.almousa@riftara.sa', name: 'Sayeed AlMousa', role: 'super_admin', title: 'Platform Administrator' },
  { email: 'khalid.alrashid@riftara.sa', name: 'Khalid AlRashid', role: 'executive', title: 'Chief Executive Officer' },
  { email: 'nora.alhamdan@riftara.sa', name: 'Nora AlHamdan', role: 'asset_manager', title: 'Head of Asset Management' },
  { email: 'faisal.alotaibi@riftara.sa', name: 'Faisal AlOtaibi', role: 'property_manager', title: 'Property Manager' },
  { email: 'sarah.mohammed@riftara.sa', name: 'Sarah Mohammed', role: 'leasing_manager', title: 'Leasing Manager' },
  { email: 'ahmed.khalid@riftara.sa', name: 'Ahmed Khalid', role: 'leasing_agent', title: 'Senior Leasing Agent' },
  { email: 'maha.alzahrani@riftara.sa', name: 'Maha AlZahrani', role: 'leasing_agent', title: 'Leasing Agent' },
  { email: 'omar.alqahtani@riftara.sa', name: 'Omar AlQahtani', role: 'finance', title: 'Finance Manager' },
  { email: 'reem.alsubaie@riftara.sa', name: 'Reem AlSubaie', role: 'collections_officer', title: 'Collections Officer' },
  { email: 'ali.kamal@riftara.sa', name: 'Ali Kamal', role: 'maintenance_manager', title: 'Maintenance Manager' },
  { email: 'yousef.aldosari@riftara.sa', name: 'Yousef AlDosari', role: 'maintenance_staff', title: 'Maintenance Technician' },
  { email: 'lama.alharbi@riftara.sa', name: 'Lama AlHarbi', role: 'marketing_manager', title: 'Marketing Manager' },
  { email: 'tariq.alnasser@riftara.sa', name: 'Tariq AlNasser', role: 'auditor', title: 'Internal Auditor' },
  { email: 'hessa.alfaisal@riftara.sa', name: 'Hessa AlFaisal', role: 'read_only', title: 'Board Observer' },
];

export async function seedReference(db: Database): Promise<ReferenceData> {
  // --- Organization --------------------------------------------------------
  const [organization] = await db
    .insert(organizations)
    .values({
      code: 'RIFTARA',
      nameEn: 'RIFTARA Real Estate Company',
      nameAr: 'شركة ريفتارا العقارية',
      legalName: 'RIFTARA Real Estate Company LLC',
      commercialRegistration: '1010512345',
      vatNumber: '300012345600003',
      defaultCurrency: 'SAR',
      defaultLocale: 'en',
      timezone: 'Asia/Riyadh',
      vatRateBps: 1500,
      addressLine: 'King Fahd Road, Al Olaya, Riyadh 12211, Saudi Arabia',
      phone: '+966 11 200 5000',
      email: 'info@riftara.sa',
    })
    .returning({ id: organizations.id });

  const organizationId = organization.id;

  // --- Permissions and roles ----------------------------------------------
  const permissionRows = await db
    .insert(permissionsTable)
    .values(
      PERMISSIONS.map((p) => ({
        key: p.key,
        module: p.module,
        action: p.action,
        description: p.description,
      })),
    )
    .returning({ id: permissionsTable.id, key: permissionsTable.key });

  const permissionIdByKey = new Map(permissionRows.map((row) => [row.key, row.id]));

  const roleRows = await db
    .insert(roles)
    .values(
      ROLE_DEFINITIONS.map((role) => ({
        organizationId,
        key: role.key,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        description: role.description,
        isSystem: true,
      })),
    )
    .returning({ id: roles.id, key: roles.key });

  const roleIds = Object.fromEntries(roleRows.map((row) => [row.key, row.id]));

  const rolePermissionRows = ROLE_DEFINITIONS.flatMap((role) =>
    resolveRolePermissions(role)
      .map((permissionKey) => {
        const permissionId = permissionIdByKey.get(permissionKey);
        return permissionId ? { roleId: roleIds[role.key], permissionId } : null;
      })
      .filter((row): row is { roleId: string; permissionId: string } => row !== null),
  );
  await db.insert(rolePermissions).values(rolePermissionRows);

  // --- Users ---------------------------------------------------------------
  const passwordHash = await hashPassword(env.SEED_DEFAULT_PASSWORD);
  const userRows = await db
    .insert(users)
    .values(
      STAFF.map((person) => ({
        organizationId,
        email: person.email,
        passwordHash,
        fullName: person.name,
        jobTitle: person.title,
        phone: '+966 50 000 0000',
        locale: 'en',
        isActive: true,
        isDemo: true,
      })),
    )
    .returning({ id: users.id, email: users.email });

  const userIdByEmail = new Map(userRows.map((row) => [row.email, row.id]));
  await db.insert(userRoles).values(
    STAFF.map((person) => ({
      userId: userIdByEmail.get(person.email) as string,
      roleId: roleIds[person.role],
    })),
  );

  const userIds = Object.fromEntries(
    STAFF.map((person) => [person.email.split('@')[0].replace('.', '_'), userIdByEmail.get(person.email) as string]),
  );

  // --- Geography -----------------------------------------------------------
  const [portfolio] = await db
    .insert(portfolios)
    .values({
      organizationId,
      code: 'CORE',
      nameEn: 'RIFTARA Core Portfolio',
      nameAr: 'محفظة ريفتارا الأساسية',
      description: 'Income-producing commercial, retail, logistics and residential assets.',
      isDemo: true,
    })
    .returning({ id: portfolios.id });

  const regionRows = await db
    .insert(regions)
    .values(
      REGIONS.map((r) => ({
        organizationId,
        code: r.key.toUpperCase(),
        nameEn: r.en,
        nameAr: r.ar,
        isDemo: true,
      })),
    )
    .returning({ id: regions.id, code: regions.code });
  const regionIds = Object.fromEntries(
    REGIONS.map((r) => [r.key, regionRows.find((row) => row.code === r.key.toUpperCase())!.id]),
  );

  const cityRows = await db
    .insert(cities)
    .values(
      CITIES.map((c) => ({
        organizationId,
        regionId: regionIds[c.region],
        code: c.key.toUpperCase(),
        nameEn: c.en,
        nameAr: c.ar,
        latitude: c.lat,
        longitude: c.lng,
        isDemo: true,
      })),
    )
    .returning({ id: cities.id, code: cities.code });
  const cityIds = Object.fromEntries(
    CITIES.map((c) => [c.key, cityRows.find((row) => row.code === c.key.toUpperCase())!.id]),
  );

  const districtRows = await db
    .insert(districts)
    .values(
      DISTRICTS.map((d) => ({
        organizationId,
        cityId: cityIds[d.city],
        code: d.key.toUpperCase(),
        nameEn: d.en,
        nameAr: d.ar,
        latitude: d.lat,
        longitude: d.lng,
        isDemo: true,
      })),
    )
    .returning({ id: districts.id, code: districts.code });
  const districtIds = Object.fromEntries(
    DISTRICTS.map((d) => [d.key, districtRows.find((row) => row.code === d.key.toUpperCase())!.id]),
  );

  // --- Taxonomies ----------------------------------------------------------
  const propertyTypeRows = await db
    .insert(propertyTypes)
    .values(
      PROPERTY_TYPES.map((t, index) => ({
        organizationId,
        key: t.key,
        nameEn: t.en,
        nameAr: t.ar,
        category: t.category,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: propertyTypes.id, key: propertyTypes.key });
  const propertyTypeIds = Object.fromEntries(propertyTypeRows.map((r) => [r.key, r.id]));

  const unitTypeRows = await db
    .insert(unitTypes)
    .values(
      UNIT_TYPES.map((t, index) => ({
        organizationId,
        key: t.key,
        nameEn: t.en,
        nameAr: t.ar,
        category: t.category,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: unitTypes.id, key: unitTypes.key });
  const unitTypeIds = Object.fromEntries(unitTypeRows.map((r) => [r.key, r.id]));

  const unitStatusRows = await db
    .insert(unitStatuses)
    .values(
      UNIT_STATUSES.map((s, index) => ({
        organizationId,
        key: s.key,
        nameEn: s.en,
        nameAr: s.ar,
        availabilityClass: s.availabilityClass,
        colorToken: s.colorToken,
        publishable: s.publishable,
        countsAsOccupied: s.countsAsOccupied,
        blocksLeasing: s.blocksLeasing,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: unitStatuses.id, key: unitStatuses.key });
  const unitStatusIds = Object.fromEntries(unitStatusRows.map((r) => [r.key, r.id]));

  const leadStageRows = await db
    .insert(leadStages)
    .values(
      LEAD_STAGES.map((s, index) => ({
        organizationId,
        key: s.key,
        nameEn: s.en,
        nameAr: s.ar,
        pipelineOrder: index,
        stageType: s.type,
        colorToken: s.color,
        probability: s.prob,
        requiresLossReason: s.type === 'lost',
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: leadStages.id, key: leadStages.key });
  const leadStageIds = Object.fromEntries(leadStageRows.map((r) => [r.key, r.id]));

  const leadSourceRows = await db
    .insert(leadSources)
    .values(
      LEAD_SOURCES.map((s, index) => ({
        organizationId,
        key: s.key,
        nameEn: s.en,
        nameAr: s.ar,
        channel: s.channel,
        marketingPlatformKey: s.platform,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: leadSources.id, key: leadSources.key });
  const leadSourceIds = Object.fromEntries(leadSourceRows.map((r) => [r.key, r.id]));

  const lossReasonRows = await db
    .insert(lossReasons)
    .values(
      LOSS_REASONS.map((r, index) => ({
        organizationId,
        key: r.key,
        nameEn: r.en,
        nameAr: r.ar,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: lossReasons.id, key: lossReasons.key });
  const lossReasonIds = Object.fromEntries(lossReasonRows.map((r) => [r.key, r.id]));

  const expenseCategoryRows = await db
    .insert(expenseCategories)
    .values(
      EXPENSE_CATEGORIES.map((c, index) => ({
        organizationId,
        key: c.key,
        nameEn: c.en,
        nameAr: c.ar,
        includedInOpex: c.opex,
        isRecoverable: c.recoverable,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: expenseCategories.id, key: expenseCategories.key });
  const expenseCategoryIds = Object.fromEntries(expenseCategoryRows.map((r) => [r.key, r.id]));

  const maintenanceCategoryRows = await db
    .insert(maintenanceCategories)
    .values(
      MAINTENANCE_CATEGORIES.map((c, index) => ({
        organizationId,
        key: c.key,
        nameEn: c.en,
        nameAr: c.ar,
        defaultResponseHours: c.response,
        defaultResolutionHours: c.resolution,
        sortOrder: index,
        isSystem: true,
      })),
    )
    .returning({ id: maintenanceCategories.id, key: maintenanceCategories.key });
  const maintenanceCategoryIds = Object.fromEntries(maintenanceCategoryRows.map((r) => [r.key, r.id]));

  await db.insert(documentCategories).values(
    DOCUMENT_CATEGORIES.map((c, index) => ({
      organizationId,
      key: c.key,
      nameEn: c.en,
      nameAr: c.ar,
      appliesTo: c.applies,
      requiresExpiry: c.expiry,
      sortOrder: index,
      isSystem: true,
    })),
  );

  const vendorRows = await db
    .insert(vendors)
    .values(
      VENDORS.map((v) => ({
        organizationId,
        code: v.key.toUpperCase().slice(0, 20),
        nameEn: v.en,
        commercialRegistration: v.cr,
        contactPerson: 'Operations Desk',
        phone: '+966 11 400 0000',
        email: `${v.key.replace(/_/g, '.')}@vendor.example`,
        slaCompliancePercent: v.sla,
        rating: v.rating,
        isDemo: true,
      })),
    )
    .returning({ id: vendors.id, code: vendors.code });
  const vendorIds = Object.fromEntries(
    VENDORS.map((v) => [v.key, vendorRows.find((r) => r.code === v.key.toUpperCase().slice(0, 20))!.id]),
  );

  const platformRows = await db
    .insert(marketingPlatforms)
    .values(
      MARKETING_PLATFORMS.map((p) => ({
        organizationId,
        key: p.key,
        name: p.name,
        category: p.category,
        brandColor: p.color,
        supportsLeadForms: p.leadForms,
        supportsConversionUpload: p.conversions,
        isDemo: true,
      })),
    )
    .returning({ id: marketingPlatforms.id, key: marketingPlatforms.key });
  const marketingPlatformIds = Object.fromEntries(platformRows.map((r) => [r.key, r.id]));

  // --- Settings, business rules, KPI dictionary ----------------------------
  await db.insert(settings).values(
    DEFAULT_SETTINGS.map((setting) => ({
      organizationId,
      key: setting.key,
      group: setting.group,
      value: setting.value,
      label: setting.label,
      description: setting.description,
      valueType: setting.valueType,
      isSystem: setting.isSystem ?? false,
    })),
  );

  await db.insert(businessRuleConfigs).values(
    BUSINESS_RULES.map((rule) => ({
      organizationId,
      ruleCode: rule.code,
      name: rule.name,
      description: rule.description,
      isEnabled: true,
      enforcement: rule.enforcement,
      parameters: rule.parameters ?? {},
    })),
  );

  const kpiRows = await db
    .insert(kpiDefinitions)
    .values(
      KPI_DICTIONARY.map((kpi) => ({
        organizationId,
        key: kpi.key,
        name: kpi.name,
        nameAr: kpi.nameAr,
        definition: kpi.definition,
        formula: kpi.formula,
        dataSource: kpi.dataSource,
        displayFormat: kpi.displayFormat,
        scope: kpi.scope,
        reportingFrequency: kpi.reportingFrequency,
        responsibleDepartment: kpi.responsibleDepartment,
        higherIsBetter: kpi.higherIsBetter,
      })),
    )
    .returning({ id: kpiDefinitions.id, key: kpiDefinitions.key });

  const thresholdRows = KPI_DICTIONARY.filter((kpi) => kpi.thresholds).map((kpi) => ({
    kpiDefinitionId: kpiRows.find((r) => r.key === kpi.key)!.id,
    scopeType: 'portfolio',
    scopeId: null,
    greenMin: Math.round((kpi.thresholds as { green: number }).green * 100),
    amberMin: Math.round((kpi.thresholds as { amber: number }).amber * 100),
    redMax: Math.round((kpi.thresholds as { red: number }).red * 100),
  }));
  if (thresholdRows.length > 0) await db.insert(kpiThresholds).values(thresholdRows);

  // --- Integration hub -----------------------------------------------------
  await db.insert(integrations).values(
    INTEGRATION_CATALOG.map((integration) => ({
      organizationId,
      key: integration.key,
      name: integration.name,
      description: integration.description,
      category: integration.category,
      // Status is derived from real credential presence, never faked.
      status: 'not_connected' as const,
      systemOfRecord: integration.systemOfRecord,
      requiredEnvKeys: integration.requiredEnvKeys,
      tokenStatus: 'missing',
      isDemo: true,
    })),
  );

  // --- Saved views (BRD 133) ----------------------------------------------
  await db.insert(savedViews).values([
    {
      organizationId,
      userId: null,
      module: 'units',
      name: 'Vacant Offices',
      filters: { availability: 'available', usageType: 'commercial' },
      sortBy: 'askingRent',
      sortDirection: 'desc',
      isShared: true,
      isSystem: true,
      isDemo: true,
    },
    {
      organizationId,
      userId: null,
      module: 'collections',
      name: 'Overdue Tenants',
      filters: { status: 'overdue' },
      sortBy: 'daysOverdue',
      sortDirection: 'desc',
      isShared: true,
      isSystem: true,
      isDemo: true,
    },
    {
      organizationId,
      userId: null,
      module: 'contracts',
      name: 'Expiring Contracts',
      filters: { expiringWithinDays: 90 },
      sortBy: 'endDate',
      sortDirection: 'asc',
      isShared: true,
      isSystem: true,
      isDemo: true,
    },
    {
      organizationId,
      userId: null,
      module: 'maintenance',
      name: 'High Maintenance Units',
      filters: { minCost: 20000 },
      sortBy: 'actualCost',
      sortDirection: 'desc',
      isShared: true,
      isSystem: true,
      isDemo: true,
    },
    {
      organizationId,
      userId: null,
      module: 'leads',
      name: 'Pending Approvals',
      filters: { stage: 'pending_approval' },
      sortBy: 'createdAt',
      sortDirection: 'desc',
      isShared: true,
      isSystem: true,
      isDemo: true,
    },
  ]);

  return {
    organizationId,
    portfolioId: portfolio.id,
    regionIds,
    cityIds,
    districtIds,
    propertyTypeIds,
    unitTypeIds,
    unitStatusIds,
    leadStageIds,
    leadSourceIds,
    lossReasonIds,
    expenseCategoryIds,
    maintenanceCategoryIds,
    vendorIds,
    marketingPlatformIds,
    userIds,
    roleIds,
  };
}
