/**
 * InspectVoice — Core Enums & Shared Types
 * All enum values match database CHECK constraints exactly.
 */

// =============================================
// INSPECTION TYPES (BS EN 1176-7)
// =============================================

export enum InspectionType {
  ROUTINE_VISUAL = 'routine_visual',
  OPERATIONAL = 'operational',
  ANNUAL_MAIN = 'annual_main',
  POST_REPAIR = 'post_repair',
  AD_HOC = 'ad_hoc',
}

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  [InspectionType.ROUTINE_VISUAL]: 'Routine Visual',
  [InspectionType.OPERATIONAL]: 'Operational',
  [InspectionType.ANNUAL_MAIN]: 'Annual Main',
  [InspectionType.POST_REPAIR]: 'Post-Repair',
  [InspectionType.AD_HOC]: 'Ad Hoc',
};

export const INSPECTION_TYPE_DESCRIPTIONS: Record<InspectionType, string> = {
  [InspectionType.ROUTINE_VISUAL]: 'Daily/weekly hazard checks — broken glass, vandalism, obvious damage',
  [InspectionType.OPERATIONAL]: '1-3 monthly functional testing — moving parts, surfaces, wear patterns',
  [InspectionType.ANNUAL_MAIN]: 'Comprehensive BS EN 1176/1177 structural and compliance assessment',
  [InspectionType.POST_REPAIR]: 'Verification inspection following maintenance or repair work',
  [InspectionType.AD_HOC]: 'One-off inspection outside regular schedule',
};

// =============================================
// RISK RATINGS
// =============================================

export enum RiskRating {
  VERY_HIGH = 'very_high',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export const RISK_RATING_LABELS: Record<RiskRating, string> = {
  [RiskRating.VERY_HIGH]: 'Very High',
  [RiskRating.HIGH]: 'High',
  [RiskRating.MEDIUM]: 'Medium',
  [RiskRating.LOW]: 'Low',
};

export const RISK_RATING_DESCRIPTIONS: Record<RiskRating, string> = {
  [RiskRating.VERY_HIGH]: 'Structural failure imminent — immediate closure required',
  [RiskRating.HIGH]: 'Significant injury risk — repair within 48 hours',
  [RiskRating.MEDIUM]: 'Potential injury risk — repair within 1 month',
  [RiskRating.LOW]: 'Minimal risk — routine maintenance',
};

/** Sorted severity order (highest first) for display and sorting */
export const RISK_RATING_ORDER: readonly RiskRating[] = [
  RiskRating.VERY_HIGH,
  RiskRating.HIGH,
  RiskRating.MEDIUM,
  RiskRating.LOW,
] as const;

// =============================================
// CONDITION RATINGS
// =============================================

export enum ConditionRating {
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  DANGEROUS = 'dangerous',
}

export const CONDITION_LABELS: Record<ConditionRating, string> = {
  [ConditionRating.GOOD]: 'Good',
  [ConditionRating.FAIR]: 'Fair',
  [ConditionRating.POOR]: 'Poor',
  [ConditionRating.DANGEROUS]: 'Dangerous',
};

// =============================================
// ACTION TIMEFRAMES
// =============================================

export enum ActionTimeframe {
  IMMEDIATE = 'immediate',
  HOURS_48 = '48_hours',
  WEEK_1 = '1_week',
  MONTH_1 = '1_month',
  NEXT_INSPECTION = 'next_inspection',
  ROUTINE = 'routine',
}

export const ACTION_TIMEFRAME_LABELS: Record<ActionTimeframe, string> = {
  [ActionTimeframe.IMMEDIATE]: 'Immediate',
  [ActionTimeframe.HOURS_48]: 'Within 48 Hours',
  [ActionTimeframe.WEEK_1]: 'Within 1 Week',
  [ActionTimeframe.MONTH_1]: 'Within 1 Month',
  [ActionTimeframe.NEXT_INSPECTION]: 'Next Inspection',
  [ActionTimeframe.ROUTINE]: 'Routine Maintenance',
};

// =============================================
// INSPECTION STATUS (State Machine)
// =============================================

export enum InspectionStatus {
  DRAFT = 'draft',
  REVIEW = 'review',
  SIGNED = 'signed',
  EXPORTED = 'exported',
}

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  [InspectionStatus.DRAFT]: 'Draft',
  [InspectionStatus.REVIEW]: 'In Review',
  [InspectionStatus.SIGNED]: 'Signed',
  [InspectionStatus.EXPORTED]: 'Exported',
};

// =============================================
// AI PROCESSING STATUS
// =============================================

export enum AIProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// =============================================
// TRANSCRIPTION METHOD
// =============================================

export enum TranscriptionMethod {
  DEEPGRAM = 'deepgram',
  WEB_SPEECH_API = 'web_speech_api',
  MANUAL = 'manual',
}

// =============================================
// SITE TYPES
// =============================================

export enum SiteType {
  PLAYGROUND = 'playground',
  PARK = 'park',
  OUTDOOR_GYM = 'outdoor_gym',
  MUGA = 'muga',
  SKATE_PARK = 'skate_park',
  SPORTS_PITCH = 'sports_pitch',
  MIXED = 'mixed',
}

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  [SiteType.PLAYGROUND]: 'Playground',
  [SiteType.PARK]: 'Park',
  [SiteType.OUTDOOR_GYM]: 'Outdoor Gym',
  [SiteType.MUGA]: 'Multi-Use Games Area',
  [SiteType.SKATE_PARK]: 'Skate Park',
  [SiteType.SPORTS_PITCH]: 'Sports Pitch',
  [SiteType.MIXED]: 'Mixed',
};

// =============================================
// SITE STATUS
// =============================================

export enum SiteStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  TEMPORARY_CLOSURE = 'temporary_closure',
}

// =============================================
// ASSET CATEGORIES
// =============================================

export enum AssetCategory {
  PLAYGROUND = 'playground',
  OUTDOOR_GYM = 'outdoor_gym',
  FURNITURE = 'furniture',
  SPORTS = 'sports',
  OTHER = 'other',
}

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  [AssetCategory.PLAYGROUND]: 'Playground Equipment',
  [AssetCategory.OUTDOOR_GYM]: 'Outdoor Gym Equipment',
  [AssetCategory.FURNITURE]: 'Park Furniture',
  [AssetCategory.SPORTS]: 'Sports Equipment',
  [AssetCategory.OTHER]: 'Other',
};

// =============================================
// ASSET TYPES (per category)
// =============================================

export enum PlaygroundAssetType {
  SWING = 'swing',
  SLIDE = 'slide',
  CLIMBING_FRAME = 'climbing_frame',
  ROUNDABOUT = 'roundabout',
  SEE_SAW = 'see_saw',
  SPRING_ROCKER = 'spring_rocker',
  CLIMBING_NET = 'climbing_net',
  MONKEY_BARS = 'monkey_bars',
  BALANCE_BEAM = 'balance_beam',
  MULTI_PLAY = 'multi_play',
  SANDPIT = 'sandpit',
  ZIPLINE = 'zipline',
}

export enum OutdoorGymAssetType {
  PULL_UP_BAR = 'pull_up_bar',
  DIP_STATION = 'dip_station',
  CROSS_TRAINER = 'cross_trainer',
  BIKE = 'bike',
  STRETCH_STATION = 'stretch_station',
  WOBBLE_BOARD = 'wobble_board',
  BALANCE_BEAM = 'balance_beam',
}

export enum FurnitureAssetType {
  BENCH = 'bench',
  BIN = 'bin',
  SIGNAGE = 'signage',
  FENCE = 'fence',
  GATE = 'gate',
  BOLLARD = 'bollard',
  PICNIC_TABLE = 'picnic_table',
  SHELTER = 'shelter',
}

/** Union of all asset types for form inputs */
export type AssetType = PlaygroundAssetType | OutdoorGymAssetType | FurnitureAssetType | string;

// =============================================
// SURFACE TYPES
// =============================================

export enum SurfaceType {
  WETPOUR = 'wetpour',
  RUBBER_MULCH = 'rubber_mulch',
  BARK_MULCH = 'bark_mulch',
  GRASS = 'grass',
  SAND = 'sand',
  ARTIFICIAL_GRASS = 'artificial_grass',
  TARMAC = 'tarmac',
  CONCRETE = 'concrete',
  OTHER = 'other',
}

export const SURFACE_TYPE_LABELS: Record<SurfaceType, string> = {
  [SurfaceType.WETPOUR]: 'Wetpour',
  [SurfaceType.RUBBER_MULCH]: 'Rubber Mulch',
  [SurfaceType.BARK_MULCH]: 'Bark Mulch',
  [SurfaceType.GRASS]: 'Grass',
  [SurfaceType.SAND]: 'Sand',
  [SurfaceType.ARTIFICIAL_GRASS]: 'Artificial Grass',
  [SurfaceType.TARMAC]: 'Tarmac',
  [SurfaceType.CONCRETE]: 'Concrete',
  [SurfaceType.OTHER]: 'Other',
};

// =============================================
// CONDITION TREND
// =============================================

export enum ConditionTrend {
  IMPROVING = 'improving',
  STABLE = 'stable',
  DETERIORATING = 'deteriorating',
}

// =============================================
// DEFECT STATUS
// =============================================

export enum DefectStatus {
  OPEN = 'open',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  VERIFIED = 'verified',
  DEFERRED = 'deferred',
  NOT_ACTIONED = 'not_actioned',
}

export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  [DefectStatus.OPEN]: 'Open',
  [DefectStatus.ASSIGNED]: 'Assigned',
  [DefectStatus.IN_PROGRESS]: 'In Progress',
  [DefectStatus.RESOLVED]: 'Resolved',
  [DefectStatus.VERIFIED]: 'Verified',
  [DefectStatus.DEFERRED]: 'Deferred',
  [DefectStatus.NOT_ACTIONED]: 'Not Actioned',
};

// =============================================
// PHOTO TYPES
// =============================================

export enum PhotoType {
  DEFECT = 'defect',
  OVERVIEW = 'overview',
  REFERENCE = 'reference',
  COMPLETION = 'completion',
}

// =============================================
// ORGANISATION TIER
// =============================================

export enum OrgTier {
  INDIVIDUAL = 'individual',
  TEAM = 'team',
  ENTERPRISE = 'enterprise',
}

// =============================================
// USER ROLES
// =============================================

export enum UserRole {
  INSPECTOR = 'inspector',
  MANAGER = 'manager',
  ADMIN = 'admin',
}

// =============================================
// COST BANDS (AI-estimated)
// =============================================

export enum CostBand {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export const COST_BAND_LABELS: Record<CostBand, string> = {
  [CostBand.LOW]: '£0–£100',
  [CostBand.MEDIUM]: '£100–£500',
  [CostBand.HIGH]: '£500+',
};

// =============================================
// WEATHER CONDITIONS
// =============================================

export enum WeatherCondition {
  DRY = 'dry',
  WET = 'wet',
  ICY = 'icy',
  SNOW = 'snow',
  WINDY = 'windy',
}

export enum SurfaceCondition {
  DRY = 'dry',
  WET = 'wet',
  ICY = 'icy',
  WATERLOGGED = 'waterlogged',
}
