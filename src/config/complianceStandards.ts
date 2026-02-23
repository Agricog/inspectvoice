/**
 * InspectVoice — BS EN Compliance Standards Reference
 * Maps equipment categories to their applicable British/European standards.
 * Used by AI analysis prompts, report generation, and defect categorisation.
 *
 * Source: BS EN 1176:2017 series + BS EN 16630:2015
 * These are the standards referenced in professional RoSPA/RPII inspection reports.
 */

export interface ComplianceStandard {
  /** Standard reference (e.g. 'BS EN 1176-1:2017') */
  code: string;
  /** Full title */
  title: string;
  /** Short description for UI display */
  description: string;
}

// =============================================
// PLAYGROUND EQUIPMENT (BS EN 1176 series)
// =============================================

export const BS_EN_1176: Record<string, ComplianceStandard> = {
  'BS EN 1176-1:2017': {
    code: 'BS EN 1176-1:2017',
    title: 'Playground equipment and surfacing — Part 1: General safety requirements and test methods',
    description: 'General safety requirements applicable to all playground equipment',
  },
  'BS EN 1176-2:2017': {
    code: 'BS EN 1176-2:2017',
    title: 'Playground equipment and surfacing — Part 2: Additional specific safety requirements and test methods for swings',
    description: 'Specific requirements for swings',
  },
  'BS EN 1176-3:2017': {
    code: 'BS EN 1176-3:2017',
    title: 'Playground equipment and surfacing — Part 3: Additional specific safety requirements and test methods for slides',
    description: 'Specific requirements for slides',
  },
  'BS EN 1176-4:2017': {
    code: 'BS EN 1176-4:2017',
    title: 'Playground equipment and surfacing — Part 4: Additional specific safety requirements and test methods for cableways',
    description: 'Specific requirements for cableways and ziplines',
  },
  'BS EN 1176-5:2019': {
    code: 'BS EN 1176-5:2019',
    title: 'Playground equipment and surfacing — Part 5: Additional specific safety requirements and test methods for carousels',
    description: 'Specific requirements for roundabouts and carousels',
  },
  'BS EN 1176-6:2017': {
    code: 'BS EN 1176-6:2017',
    title: 'Playground equipment and surfacing — Part 6: Additional specific safety requirements and test methods for rocking equipment',
    description: 'Specific requirements for spring rockers and see-saws',
  },
  'BS EN 1176-7:2020': {
    code: 'BS EN 1176-7:2020',
    title: 'Playground equipment and surfacing — Part 7: Guidance on installation, inspection, maintenance and operation',
    description: 'Inspection guidance — defines routine, operational, and annual inspection requirements',
  },
  'BS EN 1176-10:2008': {
    code: 'BS EN 1176-10:2008',
    title: 'Playground equipment and surfacing — Part 10: Additional specific safety requirements and test methods for fully enclosed play equipment',
    description: 'Specific requirements for enclosed play structures',
  },
  'BS EN 1176-11:2014': {
    code: 'BS EN 1176-11:2014',
    title: 'Playground equipment and surfacing — Part 11: Additional specific safety requirements and test methods for spatial networks',
    description: 'Specific requirements for climbing nets and spatial network structures',
  },
} as const;

// =============================================
// IMPACT SURFACING
// =============================================

export const BS_EN_1177: ComplianceStandard = {
  code: 'BS EN 1177:2018',
  title: 'Impact attenuating playground surfacing — Methods of test for determination of impact attenuation',
  description: 'Safety surfacing impact attenuation requirements',
};

// =============================================
// OUTDOOR GYM EQUIPMENT
// =============================================

export const BS_EN_16630: ComplianceStandard = {
  code: 'BS EN 16630:2015',
  title: 'Permanently installed outdoor fitness equipment — Safety requirements and test methods',
  description: 'Safety requirements for outdoor gym equipment',
};

// =============================================
// STANDARD LOOKUP BY ASSET TYPE
// =============================================

/**
 * Get applicable compliance standards for a given asset type.
 * Returns primary standard + general requirements standard.
 */
export function getStandardsForAssetType(assetType: string): ComplianceStandard[] {
  const general = BS_EN_1176['BS EN 1176-1:2017'];
  const inspection = BS_EN_1176['BS EN 1176-7:2020'];

  if (!general || !inspection) return [];

  const standards: ComplianceStandard[] = [general, inspection];

  switch (assetType) {
    case 'swing':
      if (BS_EN_1176['BS EN 1176-2:2017']) standards.push(BS_EN_1176['BS EN 1176-2:2017']);
      break;
    case 'slide':
      if (BS_EN_1176['BS EN 1176-3:2017']) standards.push(BS_EN_1176['BS EN 1176-3:2017']);
      break;
    case 'zipline':
      if (BS_EN_1176['BS EN 1176-4:2017']) standards.push(BS_EN_1176['BS EN 1176-4:2017']);
      break;
    case 'roundabout':
      if (BS_EN_1176['BS EN 1176-5:2019']) standards.push(BS_EN_1176['BS EN 1176-5:2019']);
      break;
    case 'see_saw':
    case 'spring_rocker':
      if (BS_EN_1176['BS EN 1176-6:2017']) standards.push(BS_EN_1176['BS EN 1176-6:2017']);
      break;
    case 'climbing_net':
      if (BS_EN_1176['BS EN 1176-11:2014']) standards.push(BS_EN_1176['BS EN 1176-11:2014']);
      break;
    case 'multi_play':
      if (BS_EN_1176['BS EN 1176-10:2008']) standards.push(BS_EN_1176['BS EN 1176-10:2008']);
      break;
    case 'pull_up_bar':
    case 'dip_station':
    case 'cross_trainer':
    case 'bike':
    case 'stretch_station':
    case 'wobble_board':
      return [BS_EN_16630];
    case 'bench':
    case 'bin':
    case 'signage':
    case 'fence':
    case 'gate':
    case 'bollard':
    case 'picnic_table':
    case 'shelter':
      return []; // General duty of care — no specific BS EN standard
    default:
      break;
  }

  // Add surfacing standard for all playground equipment
  if (!['pull_up_bar', 'dip_station', 'cross_trainer', 'bike', 'stretch_station',
    'wobble_board', 'bench', 'bin', 'signage', 'fence', 'gate', 'bollard',
    'picnic_table', 'shelter'].includes(assetType)) {
    standards.push(BS_EN_1177);
  }

  return standards;
}

/**
 * Format standards as a comma-separated reference string for reports.
 * e.g. "BS EN 1176-1:2017, BS EN 1176-2:2017, BS EN 1177:2018"
 */
export function formatStandardsReference(assetType: string): string {
  const standards = getStandardsForAssetType(assetType);
  if (standards.length === 0) return 'General duty of care';
  return standards.map((s) => s.code).join(', ');
}
