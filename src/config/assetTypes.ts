/**
 * InspectVoice — Asset Type Configuration
 * Defines inspection points, risk criteria, and BS EN defect categories
 * for every supported equipment type.
 *
 * This configuration drives:
 * - Inspection checklists (what to check per asset)
 * - AI analysis prompts (risk criteria sent to Claude)
 * - Report defect categorisation (BS EN section references)
 * - Risk rating guidance (what constitutes each severity level)
 *
 * Extensible: add new asset types by adding entries to ASSET_TYPE_CONFIG.
 */

import { AssetCategory } from '@/types';
import { formatStandardsReference } from './complianceStandards';

// =============================================
// TYPES
// =============================================

export interface AssetTypeConfig {
  /** Internal key (matches AssetType enum value) */
  key: string;
  /** Display name */
  name: string;
  /** Asset category */
  category: AssetCategory;
  /** Applicable compliance standards (auto-resolved) */
  complianceStandard: string;
  /** Inspection points — what to check during inspection */
  inspectionPoints: InspectionPoint[];
  /** Risk criteria per severity level */
  riskCriteria: RiskCriteria;
  /** BS EN defect category references for AI analysis */
  bsEnDefectCategories: string[];
}

export interface InspectionPoint {
  /** Short label for checklist */
  label: string;
  /** Detailed description for inspector guidance */
  description: string;
  /** Which inspection types this point applies to */
  appliesTo: ('routine_visual' | 'operational' | 'annual_main')[];
}

export interface RiskCriteria {
  very_high: string[];
  high: string[];
  medium: string[];
  low: string[];
}

// =============================================
// PLAYGROUND EQUIPMENT
// =============================================

const SWING: AssetTypeConfig = {
  key: 'swing',
  name: 'Swing',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('swing'),
  inspectionPoints: [
    {
      label: 'Chain/rope suspension condition',
      description: 'Check all chain links and rope for corrosion, wear, fraying. Measure chain link wear against manufacturer tolerances.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Seat integrity and attachment',
      description: 'Check seat for cracks, splits, deformation. Verify seat-to-chain/rope connection is secure.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bearing/pivot mechanism',
      description: 'Check top bar bearings for seizure, excessive play, noise. Lubricate if required.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Impact surface beneath equipment',
      description: 'Check safety surfacing depth, coverage, and condition within the full swing arc plus clearance zones.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Clearance zones (front/rear/side)',
      description: 'Verify no obstructions within the swing clearance zone. Minimum clearance per BS EN 1176-2.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Structural frame condition',
      description: 'Check frame for rust, cracks, bent members, weld integrity. Examine all bolted connections.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation exposure/stability',
      description: 'Check for exposed foundations, ground erosion around posts. Test frame stability by rocking.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Entrapment hazards',
      description: 'Check for finger, head, and clothing entrapment points per BS EN 1176-1 probes.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Broken chain/rope links',
      'Seat detached or crack >50mm',
      'Exposed concrete foundation',
      'Sharp protrusion >8mm',
      'Fall height >3m without adequate surfacing',
    ],
    high: [
      'Chain/rope corrosion affecting 3+ links',
      'Seat crack 30-50mm',
      'Bearing seizure or excessive play',
      'Impact surface depth <50% of requirement',
      'Clearance zone obstruction',
    ],
    medium: [
      'Surface rust on non-load-bearing parts',
      'Minor seat crack <30mm',
      'Squeaking bearings (functional but worn)',
      'Impact surface compaction',
      'Paint deterioration exposing bare metal',
    ],
    low: [
      'Cosmetic paint wear',
      'Minor surface marks on seat',
      'Slight operational noise within tolerances',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.8.2 — Suspension system deterioration',
    'BS EN 1176-2:2017 §4.2.9 — Seat integrity requirements',
    'BS EN 1176-2:2017 §4.2.10 — Impact surface compliance',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
  ],
};

const SLIDE: AssetTypeConfig = {
  key: 'slide',
  name: 'Slide',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('slide'),
  inspectionPoints: [
    {
      label: 'Slide surface condition',
      description: 'Check for cracks, rough patches, delamination, exposed edges on the sliding surface.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Side barriers and handrails',
      description: 'Verify side barriers are intact, correct height, no gaps. Check handrail security.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Start section/platform',
      description: 'Check platform surface for slip resistance, barrier condition, and step access.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Run-out section',
      description: 'Check exit area for adequate run-out length. Verify surfacing extends beyond run-out zone.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Structural supports',
      description: 'Check all supports, legs, and connections for corrosion, cracks, stability.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Impact surfacing at exit',
      description: 'Verify safety surfacing at slide exit meets CFH requirements.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Ladder/steps condition',
      description: 'Check rungs/steps for damage, slip resistance, spacing compliance.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment and protrusion check',
      description: 'Test all joints, bolt heads, and gaps for entrapment and protrusion hazards.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Broken or missing side barrier',
      'Sharp edge on sliding surface',
      'Structural failure of supports',
      'Missing or severely degraded exit surfacing',
      'Head entrapment hazard identified',
    ],
    high: [
      'Crack >50mm on sliding surface',
      'Loose handrail',
      'Run-out zone obstructed',
      'Significant rust on structural members',
      'Step/rung damage affecting safe access',
    ],
    medium: [
      'Surface roughening (friction increase)',
      'Minor crack <50mm on slide surface',
      'Surface rust on non-structural parts',
      'Surfacing compaction at exit zone',
      'Paint peeling on barriers',
    ],
    low: [
      'Cosmetic surface marks',
      'Minor graffiti',
      'Slight discolouration',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-3:2017 §4.2 — Slide surface requirements',
    'BS EN 1176-3:2017 §4.3 — Side barrier requirements',
    'BS EN 1176-3:2017 §4.4 — Start and run-out sections',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const CLIMBING_FRAME: AssetTypeConfig = {
  key: 'climbing_frame',
  name: 'Climbing Frame',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('climbing_frame'),
  inspectionPoints: [
    {
      label: 'Structural frame integrity',
      description: 'Check all frame members, welds, and joints for cracks, corrosion, deformation.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Climbing holds/rungs',
      description: 'Check all climbing holds and rungs are secure, undamaged, and have adequate grip.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Platform and deck surfaces',
      description: 'Check all platforms for slip resistance, drainage, structural integrity.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Guard rails and barriers',
      description: 'Verify all guard rails at height are secure, correct height, no gaps exceeding limits.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bolt connections and fixings',
      description: 'Check all visible bolts for tightness, corrosion, missing caps. Torque test on annual.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Fall height and surfacing',
      description: 'Measure critical fall heights. Verify surfacing depth and coverage at all landing zones.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Entrapment hazards',
      description: 'Test all openings with BS EN 1176-1 probes for head, finger, and body entrapment.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Foundation condition',
      description: 'Check for ground erosion, exposed footings, post movement.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural member failure or severe cracking',
      'Missing guard rail section at height >600mm',
      'Head entrapment hazard identified',
      'Fall height >3m without compliant surfacing',
      'Exposed sharp edge or protrusion >8mm at height',
    ],
    high: [
      'Loose climbing holds',
      'Significant weld deterioration',
      'Guard rail movement under load',
      'Platform surface damage creating trip hazard',
      'Multiple missing bolt caps exposing threads',
    ],
    medium: [
      'Surface rust on structural members (not affecting integrity)',
      'Minor platform surface wear',
      'Single bolt cap missing',
      'Surfacing compaction below equipment',
      'Paint deterioration on bars (grip concern)',
    ],
    low: [
      'Cosmetic paint wear',
      'Minor surface marks',
      'Slight fading/discolouration',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.6 — Guard rails and barriers',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §4.2.8 — Protrusions',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const ROUNDABOUT: AssetTypeConfig = {
  key: 'roundabout',
  name: 'Roundabout',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('roundabout'),
  inspectionPoints: [
    {
      label: 'Rotating mechanism',
      description: 'Check bearing function, rotation smoothness, speed limitation device if fitted.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Platform/deck surface',
      description: 'Check for slip resistance, damage, drainage. Verify anti-slip surface intact.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Handgrips and handrails',
      description: 'Check all grips are secure, undamaged, and provide adequate hold.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Clearance zone (perimeter)',
      description: 'Verify no obstructions within the rotation clearance zone. Check ground level vs platform.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment beneath platform',
      description: 'Check gap between platform underside and ground for foot/limb entrapment risk.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Foundation and centre post',
      description: 'Check centre post for corrosion, stability. Verify foundation condition.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bearing failure causing jamming or uncontrolled spin',
      'Entrapment gap beneath platform',
      'Structural failure of platform or centre post',
      'Missing handgrips with fall risk',
    ],
    high: [
      'Excessive bearing play causing wobble',
      'Damaged handgrip',
      'Platform surface damage creating trip hazard',
      'Clearance zone obstruction',
    ],
    medium: [
      'Bearing noise (functional but worn)',
      'Minor platform surface wear',
      'Surface rust on non-structural parts',
      'Anti-slip surface wearing thin',
    ],
    low: [
      'Cosmetic paint wear',
      'Minor graffiti',
      'Slight operational noise',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-5:2019 §4.2 — Rotating equipment requirements',
    'BS EN 1176-5:2019 §4.3 — Speed limitation',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
  ],
};

const SEE_SAW: AssetTypeConfig = {
  key: 'see_saw',
  name: 'See-Saw',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('see_saw'),
  inspectionPoints: [
    {
      label: 'Pivot mechanism',
      description: 'Check pivot bearing for wear, play, lubrication. Test for smooth operation.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Seat condition',
      description: 'Check seats for cracks, splits, secure attachment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Handgrips',
      description: 'Verify all handgrips secure, undamaged, and correctly positioned.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Ground clearance and impact absorber',
      description: 'Check bumper/stopper condition. Verify adequate ground clearance and surfacing beneath seats.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Beam and structural condition',
      description: 'Check beam for cracks, corrosion, deformation. Verify weld integrity.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Finger entrapment at pivot',
      description: 'Test pivot area for finger entrapment risk using BS EN 1176-1 probes.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Pivot failure',
      'Seat detached',
      'Finger entrapment at pivot confirmed',
      'Beam structural crack',
    ],
    high: [
      'Excessive pivot play',
      'Bumper/stopper missing or failed',
      'Seat crack >30mm',
      'Handgrip loose or damaged',
    ],
    medium: [
      'Pivot noise (functional)',
      'Minor seat crack <30mm',
      'Bumper compression (still functional)',
      'Surface rust on beam',
    ],
    low: [
      'Cosmetic wear',
      'Paint fading',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-6:2017 §4.2 — Rocking equipment requirements',
    'BS EN 1176-6:2017 §4.3 — Impact absorber requirements',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
  ],
};

const SPRING_ROCKER: AssetTypeConfig = {
  key: 'spring_rocker',
  name: 'Spring Rocker',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('spring_rocker'),
  inspectionPoints: [
    {
      label: 'Spring condition',
      description: 'Check spring for corrosion, fatigue cracks, deformation. Test flex in all directions.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Seat/body condition',
      description: 'Check moulded body for cracks, UV degradation, sharp edges from damage.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Handgrips and footrests',
      description: 'Verify grips and rests are secure, undamaged.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation plate and bolts',
      description: 'Check foundation plate is level, secure, bolts tight. Verify no ground erosion.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Spring-to-seat connection',
      description: 'Check top plate connection for cracks, loose bolts.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Spring failure or fatigue crack visible',
      'Seat detached from spring',
      'Foundation plate loose allowing tipping',
    ],
    high: [
      'Significant spring corrosion',
      'Seat body crack >50mm',
      'Handgrip broken',
      'Foundation bolts loose',
    ],
    medium: [
      'Surface rust on spring (not affecting integrity)',
      'Minor body crack <50mm',
      'Footrest worn',
      'Ground erosion around base',
    ],
    low: [
      'Paint fading',
      'Cosmetic marks on body',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-6:2017 §4.2 — Rocking equipment requirements',
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.8 — Protrusions from damage',
  ],
};

const CLIMBING_NET: AssetTypeConfig = {
  key: 'climbing_net',
  name: 'Climbing Net',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('climbing_net'),
  inspectionPoints: [
    {
      label: 'Net/rope condition',
      description: 'Check all ropes/cables for fraying, cuts, UV degradation, knot integrity.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Connection points',
      description: 'Check where ropes connect to frame — clamps, thimbles, ferrules all secure.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Frame structure',
      description: 'Check frame for corrosion, weld integrity, stability.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Net tension',
      description: 'Check net tension is appropriate — not too slack (entrapment) or too tight (injury).',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Fall height and surfacing',
      description: 'Measure maximum fall height. Verify surfacing coverage and depth at all landing points.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Entrapment in mesh',
      description: 'Check mesh size for head and body entrapment compliance.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Rope/cable severed or nearly severed',
      'Connection point failure',
      'Head entrapment mesh size non-compliant',
      'Frame structural failure',
    ],
    high: [
      'Multiple rope strands frayed (>25% diameter)',
      'Loose connection clamp',
      'Excessive net slack creating entrapment',
      'Frame corrosion at weld points',
    ],
    medium: [
      'Surface fraying on rope (<25% diameter)',
      'UV degradation visible on ropes',
      'Minor frame surface rust',
      'Surfacing compaction beneath',
    ],
    low: [
      'Cosmetic discolouration of ropes',
      'Minor surface marks on frame',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-11:2014 §4.2 — Spatial network requirements',
    'BS EN 1176-11:2014 §4.3 — Mesh size requirements',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const MONKEY_BARS: AssetTypeConfig = {
  key: 'monkey_bars',
  name: 'Monkey Bars',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('monkey_bars'),
  inspectionPoints: [
    {
      label: 'Bar condition and security',
      description: 'Check each bar for corrosion, bending, secure attachment at both ends.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bar spacing',
      description: 'Verify consistent spacing between bars. Check for entrapment between bars.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and support structure',
      description: 'Check uprights and cross-members for corrosion, weld integrity, stability.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Impact surfacing',
      description: 'Verify surfacing beneath entire traverse route meets CFH requirements.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Foundation condition',
      description: 'Check uprights at ground level for corrosion, ground erosion.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bar detached or nearly detached',
      'Structural failure of support frame',
      'Missing surfacing beneath traverse',
      'Sharp edge from bar damage',
    ],
    high: [
      'Bar bending under load',
      'Significant frame corrosion',
      'Surfacing depth <50% requirement',
      'Loose bar with rotational play',
    ],
    medium: [
      'Surface rust on bars (grip concern)',
      'Minor frame surface corrosion',
      'Surfacing compaction',
      'Paint deterioration on bars',
    ],
    low: [
      'Cosmetic wear',
      'Minor paint fading',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const BALANCE_BEAM_PLAYGROUND: AssetTypeConfig = {
  key: 'balance_beam',
  name: 'Balance Beam',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('balance_beam'),
  inspectionPoints: [
    {
      label: 'Beam surface condition',
      description: 'Check walking surface for slip resistance, cracks, splinters (timber), corrosion (metal).',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Support posts',
      description: 'Check support posts for stability, corrosion, rot (timber), secure fixings.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Impact surfacing',
      description: 'Verify surfacing beneath and around beam meets fall height requirements.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Foundation condition',
      description: 'Check ground level for erosion, exposed footings.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Beam structural failure',
      'Support post collapse',
      'Sharp edge or splinter risk from break',
    ],
    high: [
      'Significant timber rot in beam',
      'Loose support post',
      'Surface slippery when wet (no grip)',
    ],
    medium: [
      'Surface wear reducing grip',
      'Minor rot or corrosion',
      'Surfacing compaction',
    ],
    low: [
      'Cosmetic wear',
      'Minor weathering',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const MULTI_PLAY: AssetTypeConfig = {
  key: 'multi_play',
  name: 'Multi-Play Unit',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('multi_play'),
  inspectionPoints: [
    {
      label: 'Overall structural integrity',
      description: 'Check all frame members, decks, towers for structural soundness.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'All access points (steps, ladders, ramps)',
      description: 'Check each access route for damage, slip resistance, handrail condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'All activity elements',
      description: 'Inspect each individual element (slides, climbing walls, poles, bridges) per relevant standard.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Platforms and decks',
      description: 'Check all platform surfaces, barriers, guard rails at each height level.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Roof/canopy (if fitted)',
      description: 'Check roof panels for damage, security, water pooling.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Bolt connections throughout',
      description: 'Check all visible fixings. Torque test critical connections on annual.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Entrapment hazards throughout',
      description: 'Systematic check of all openings, gaps, and transitions between elements.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Impact surfacing (all zones)',
      description: 'Verify surfacing at all landing/fall zones around the full perimeter.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural failure of any frame member',
      'Missing guard rail section at height',
      'Head entrapment hazard',
      'Sharp edge from damage at height',
      'Platform collapse risk',
    ],
    high: [
      'Loose or damaged guard rail',
      'Access point damage preventing safe use',
      'Multiple bolt failures',
      'Significant rot/corrosion on structural members',
      'Missing surfacing at critical fall zone',
    ],
    medium: [
      'Individual element wear (single slide crack, etc)',
      'Surface rust on non-critical parts',
      'Platform surface wear',
      'Surfacing compaction',
      'Minor roof panel damage',
    ],
    low: [
      'Cosmetic paint wear',
      'Minor graffiti',
      'Slight fading',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.6 — Guard rails and barriers',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §4.2.8 — Protrusions',
    'BS EN 1176-10:2008 §4.2 — Enclosed play equipment',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

const SANDPIT: AssetTypeConfig = {
  key: 'sandpit',
  name: 'Sandpit',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('sandpit'),
  inspectionPoints: [
    {
      label: 'Sand condition',
      description: 'Check for contamination (animal fouling, glass, sharps, litter). Assess sand depth and quality.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Edging/border condition',
      description: 'Check timber/stone edging for damage, splinters, sharp edges, trip hazards.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Drainage',
      description: 'Check for standing water, waterlogging, drainage function.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Cover condition (if fitted)',
      description: 'Check sand pit cover for damage, security, ease of removal.',
      appliesTo: ['operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Needles or hazardous sharps in sand',
      'Significant animal fouling contamination',
    ],
    high: [
      'Broken glass in sand',
      'Sharp edge on edging/border',
      'Standing water (drowning risk for infants)',
    ],
    medium: [
      'Litter in sand',
      'Sand depth below recommended level',
      'Minor edging damage',
      'Poor drainage',
    ],
    low: [
      'Sand discolouration',
      'Minor weed growth at edges',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2 — General safety requirements',
    'BS EN 1176-7:2020 §6 — Maintenance requirements',
  ],
};

const ZIPLINE: AssetTypeConfig = {
  key: 'zipline',
  name: 'Zipline / Cableway',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('zipline'),
  inspectionPoints: [
    {
      label: 'Cable condition',
      description: 'Check cable for fraying, kinks, corrosion. Measure cable diameter for wear.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Trolley/carriage mechanism',
      description: 'Check trolley wheels, bearings, and brake/buffer mechanism.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Handle/seat attachment',
      description: 'Check seat or handle attachment to trolley for security and wear.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Terminal posts and tensioning',
      description: 'Check both end posts for stability, cable tensioning device function.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Buffer/stop at terminal',
      description: 'Check end buffer condition and effectiveness. Test stop mechanism.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Clearance zone (full run)',
      description: 'Verify no obstructions along the full cable run and landing zone.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Impact surfacing',
      description: 'Verify surfacing at launch, landing, and along the route.',
      appliesTo: ['operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Cable fraying >25% diameter',
      'Trolley mechanism failure',
      'Missing or failed end buffer',
      'Terminal post instability',
    ],
    high: [
      'Cable fraying <25% but visible strands broken',
      'Handle/seat attachment worn',
      'Buffer worn beyond effective function',
      'Clearance zone obstruction',
    ],
    medium: [
      'Surface cable corrosion',
      'Trolley bearing noise (functional)',
      'Minor buffer compression',
      'Surfacing wear at landing',
    ],
    low: [
      'Cable surface discolouration',
      'Minor cosmetic wear',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-4:2017 §4.2 — Cableway requirements',
    'BS EN 1176-4:2017 §4.3 — Terminal and buffer requirements',
    'BS EN 1176-1:2017 §5.3 — Critical fall height assessment',
  ],
};

// =============================================
// OUTDOOR GYM EQUIPMENT
// =============================================

const PULL_UP_BAR: AssetTypeConfig = {
  key: 'pull_up_bar',
  name: 'Pull-Up Bar Station',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: formatStandardsReference('pull_up_bar'),
  inspectionPoints: [
    {
      label: 'Bar condition and grip',
      description: 'Check bars for corrosion, bending, grip surface condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Frame structure',
      description: 'Check frame uprights and cross-members for stability, corrosion, weld condition.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and fixings',
      description: 'Check ground fixings, base plates, ground erosion.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'User information signage',
      description: 'Verify instruction signage is present, legible, and correct.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Surfacing beneath equipment',
      description: 'Check surface condition for safe use.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bar detachment or structural failure',
      'Frame collapse',
      'Sharp edge from damage',
    ],
    high: [
      'Significant bar corrosion affecting grip safety',
      'Frame corrosion at weld points',
      'Foundation movement',
    ],
    medium: [
      'Surface rust (not affecting function)',
      'Signage faded or missing',
      'Surfacing wear',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §5 — User information requirements',
  ],
};

// =============================================
// PARK FURNITURE
// =============================================

const BENCH: AssetTypeConfig = {
  key: 'bench',
  name: 'Bench',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Seating surface',
      description: 'Check for splinters (timber), cracks, broken slats, sharp edges.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Frame/supports',
      description: 'Check legs and frame for stability, corrosion, breakage.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Fixings',
      description: 'Check all bolts/screws for tightness, corrosion, missing heads.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation/anchoring',
      description: 'Check bench is securely anchored and level.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural collapse risk',
      'Exposed nail/screw causing laceration',
    ],
    high: [
      'Broken slat creating gap',
      'Severe splinter risk from timber deterioration',
      'Unstable — tips under load',
    ],
    medium: [
      'Minor timber splinters',
      'Surface rust on frame',
      'Loose slat',
    ],
    low: [
      'Paint wear',
      'Minor weathering',
      'Graffiti',
    ],
  },
  bsEnDefectCategories: [],
};

const GATE: AssetTypeConfig = {
  key: 'gate',
  name: 'Gate',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Self-closing mechanism',
      description: 'Test gate self-closes fully from fully open position.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Latch function',
      description: 'Test latch engages securely. Check child-proof mechanism if fitted.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Hinge condition',
      description: 'Check hinges for corrosion, play, alignment. Lubricate if needed.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Gate structure',
      description: 'Check gate panel for damage, rot (timber), corrosion (metal).',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Finger entrapment at hinge side',
      description: 'Check hinge gap for finger entrapment risk.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Gate does not close or latch (containment failure)',
      'Finger entrapment at hinges',
      'Gate collapsed or detached',
    ],
    high: [
      'Self-closer not functioning',
      'Latch intermittently failing',
      'Significant structural damage to gate panel',
    ],
    medium: [
      'Self-closer slow',
      'Hinge stiff (still functional)',
      'Surface rust on fittings',
    ],
    low: [
      'Paint wear',
      'Minor surface marks',
    ],
  },
  bsEnDefectCategories: [],
};

const FENCE: AssetTypeConfig = {
  key: 'fence',
  name: 'Fence',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Panel integrity',
      description: 'Check for broken, bent, or missing fence panels/rails.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Post condition',
      description: 'Check posts for rot (timber), corrosion (metal), stability.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Sharp edges/protrusions',
      description: 'Check for exposed wire ends, broken rail tips, protruding fixings.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Climbing prevention',
      description: 'Check fence design does not create easy footholds for climbing.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Fence section collapsed (containment failure near road/water)',
      'Exposed sharp wire causing laceration risk',
    ],
    high: [
      'Multiple panels missing/broken (containment breach)',
      'Post leaning significantly',
      'Sharp protrusion at child height',
    ],
    medium: [
      'Single panel damaged',
      'Post rot visible but stable',
      'Surface corrosion',
    ],
    low: [
      'Paint wear',
      'Minor weathering',
    ],
  },
  bsEnDefectCategories: [],
};

// =============================================
// MASTER CONFIGURATION REGISTRY
// =============================================

export const ASSET_TYPE_CONFIG: Record<string, AssetTypeConfig> = {
  swing: SWING,
  slide: SLIDE,
  climbing_frame: CLIMBING_FRAME,
  roundabout: ROUNDABOUT,
  see_saw: SEE_SAW,
  spring_rocker: SPRING_ROCKER,
  climbing_net: CLIMBING_NET,
  monkey_bars: MONKEY_BARS,
  balance_beam: BALANCE_BEAM_PLAYGROUND,
  multi_play: MULTI_PLAY,
  sandpit: SANDPIT,
  zipline: ZIPLINE,
  pull_up_bar: PULL_UP_BAR,
  bench: BENCH,
  gate: GATE,
  fence: FENCE,
} as const;

// =============================================
// LOOKUP HELPERS
// =============================================

/** Get config for an asset type, or null if not found */
export function getAssetTypeConfig(assetType: string): AssetTypeConfig | null {
  return ASSET_TYPE_CONFIG[assetType] ?? null;
}

/** Get inspection points filtered by inspection type */
export function getInspectionPointsForType(
  assetType: string,
  inspectionType: 'routine_visual' | 'operational' | 'annual_main',
): InspectionPoint[] {
  const config = getAssetTypeConfig(assetType);
  if (!config) return [];
  return config.inspectionPoints.filter((point) => point.appliesTo.includes(inspectionType));
}

/** Get all asset types for a category */
export function getAssetTypesForCategory(category: AssetCategory): AssetTypeConfig[] {
  return Object.values(ASSET_TYPE_CONFIG).filter((config) => config.category === category);
}

/** Get risk criteria descriptions for a given asset type and severity */
export function getRiskExamples(assetType: string, severity: keyof RiskCriteria): string[] {
  const config = getAssetTypeConfig(assetType);
  if (!config) return [];
  return config.riskCriteria[severity];
}
