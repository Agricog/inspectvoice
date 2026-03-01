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
 *
 * Current count: 39 types (16 original + 19 new + 4 custom/other)
 *   - Playground: 16 + 1 custom
 *   - Outdoor Gym: 10 + 1 custom
 *   - Furniture: 6 + 1 custom
 *   - Sports: 3 + 1 custom
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

// ---- NEW: Playground additions ----

const SPINNER_BOWL: AssetTypeConfig = {
  key: 'spinner_bowl',
  name: 'Spinner Bowl / Spinning Disk',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('spinner_bowl'),
  inspectionPoints: [
    {
      label: 'Bowl/disk surface condition',
      description: 'Check for cracks, UV degradation, sharp edges from damage. Verify anti-slip texture.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bearing and rotation mechanism',
      description: 'Check rotation is smooth, no seizure, no excessive speed. Test bearing play.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment beneath bowl',
      description: 'Check gap between bowl underside and ground for foot/limb entrapment.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and centre post',
      description: 'Check centre spindle, base plate, and foundation for corrosion and stability.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Impact surfacing',
      description: 'Verify surfacing around full perimeter is adequate for fall height.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bowl cracked through (structural failure)',
      'Bearing failure causing sudden stop or uncontrolled spin',
      'Entrapment gap beneath bowl',
    ],
    high: [
      'Significant cracks affecting structural integrity',
      'Excessive bearing play causing wobble',
      'Sharp edge from impact damage',
    ],
    medium: [
      'Surface wear reducing grip',
      'Bearing noise (functional but worn)',
      'Minor surface cracks (cosmetic)',
    ],
    low: [
      'Surface discolouration',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-5:2019 §4.2 — Rotating equipment requirements',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
  ],
};

const IN_GROUND_TRAMPOLINE: AssetTypeConfig = {
  key: 'in_ground_trampoline',
  name: 'In-Ground Trampoline',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('in_ground_trampoline'),
  inspectionPoints: [
    {
      label: 'Mat/bed condition',
      description: 'Check bouncing mat for tears, UV degradation, stitch separation, sagging.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Pad/skirt covering',
      description: 'Check perimeter padding covers all springs/edges. Verify padding thickness and attachment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Springs/elastic elements',
      description: 'Check all springs for stretch, corrosion, hook integrity. Count missing springs.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Frame condition (below ground)',
      description: 'Check visible frame for corrosion, structural integrity. Verify drainage beneath.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Perimeter edging and ground level',
      description: 'Check ground-to-frame junction for trip hazards, gaps, erosion.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Clearance zone',
      description: 'Verify no obstructions within the bounce clearance zone around the trampoline.',
      appliesTo: ['operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Mat tear allowing fall-through',
      'Multiple springs missing creating gap',
      'Frame structural failure',
      'Exposed spring hooks with no padding',
    ],
    high: [
      'Mat stitch separation >100mm',
      'Padding displaced exposing springs',
      '3+ springs missing or broken',
      'Frame corrosion at joints',
    ],
    medium: [
      'Minor mat wear (no tear)',
      'Padding compression reducing protection',
      'Single spring missing',
      'Perimeter edging gap',
    ],
    low: [
      'Mat surface fading',
      'Minor padding cosmetic damage',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-7:2020 §6 — Maintenance requirements',
  ],
};

const TUNNEL: AssetTypeConfig = {
  key: 'tunnel',
  name: 'Tunnel / Crawl Tube',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('tunnel'),
  inspectionPoints: [
    {
      label: 'Tunnel body condition',
      description: 'Check for cracks, holes, sharp edges, UV degradation. Verify internal surface smooth.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Entry/exit openings',
      description: 'Check openings for sharp edges, entrapment points, adequate size.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Internal cleanliness',
      description: 'Check for debris, standing water, animal fouling, vandalism inside tunnel.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Fixings and anchorage',
      description: 'Check tunnel is securely fixed, cannot roll or shift. Verify connections to other equipment.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Drainage',
      description: 'Check for water pooling inside. Verify drainage holes are clear.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural collapse risk',
      'Sharp edge at entry/exit at head height',
      'Entrapment hazard within tunnel',
    ],
    high: [
      'Significant crack compromising structure',
      'Tunnel loose or shifted from fixings',
      'Needle or sharps contamination inside',
    ],
    medium: [
      'Minor cracks (cosmetic)',
      'Standing water inside',
      'Surface roughening at entries',
    ],
    low: [
      'Graffiti inside',
      'Surface discolouration',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-10:2008 §4.2 — Enclosed play equipment',
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
  ],
};

const PLAYHOUSE: AssetTypeConfig = {
  key: 'playhouse',
  name: 'Playhouse / Den',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: formatStandardsReference('playhouse'),
  inspectionPoints: [
    {
      label: 'Wall and panel condition',
      description: 'Check all walls for cracks, rot (timber), sharp edges, loose panels.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Roof condition',
      description: 'Check roof for damage, water ingress, loose fixings. Verify structural soundness.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Doorway and window openings',
      description: 'Check openings for entrapment hazards, sharp edges, finger traps on hinged items.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Internal space',
      description: 'Check floor surface, internal fixtures, cleanliness. No sharp or protruding items.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Foundation and stability',
      description: 'Check structure is stable, level, securely anchored. No leaning or rocking.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Roof collapse risk',
      'Wall panel detached at height',
      'Head entrapment in window/door opening',
    ],
    high: [
      'Significant timber rot affecting structure',
      'Sharp edge at child height',
      'Finger entrapment at hinge point',
    ],
    medium: [
      'Minor timber rot or surface damage',
      'Loose panel (not at height)',
      'Floor surface worn',
    ],
    low: [
      'Paint wear',
      'Cosmetic marks',
      'Minor graffiti',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-10:2008 §4.2 — Enclosed play equipment',
  ],
};

// ---- Custom: Playground ----

const CUSTOM_PLAYGROUND: AssetTypeConfig = {
  key: 'custom_playground',
  name: 'Other Playground Equipment',
  category: AssetCategory.PLAYGROUND,
  complianceStandard: 'BS EN 1176-1:2017 (General playground safety)',
  inspectionPoints: [
    {
      label: 'Overall structural condition',
      description: 'Check all structural members, joints, welds, and connections for integrity.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Surface condition and sharp edges',
      description: 'Check all surfaces for damage, sharp edges, protrusions, splinters.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Moving parts and mechanisms',
      description: 'Check all moving parts for function, wear, entrapment risk, lubrication.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Fixings and connections',
      description: 'Check all bolts, screws, and fixings for tightness and condition.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment hazards',
      description: 'Test all openings and gaps for head, finger, and body entrapment per BS EN 1176-1.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Impact surfacing',
      description: 'Verify safety surfacing depth and coverage at all fall/landing zones.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Foundation and stability',
      description: 'Check foundations, ground erosion, and overall equipment stability.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural failure or collapse risk',
      'Head entrapment hazard',
      'Sharp protrusion >8mm at height',
      'Missing guard rail/barrier at height >600mm',
    ],
    high: [
      'Significant structural corrosion or rot',
      'Moving part malfunction creating injury risk',
      'Missing or severely degraded surfacing',
    ],
    medium: [
      'Surface rust not affecting integrity',
      'Minor component wear',
      'Surfacing compaction',
    ],
    low: [
      'Cosmetic wear',
      'Minor weathering',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1176-1:2017 §4.2.4 — Structural integrity',
    'BS EN 1176-1:2017 §4.2.7 — Entrapment hazards',
    'BS EN 1176-1:2017 §4.2.8 — Protrusions',
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

const CROSS_TRAINER: AssetTypeConfig = {
  key: 'cross_trainer',
  name: 'Cross Trainer / Elliptical',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Pedal condition and attachment',
      description: 'Check pedals for cracks, grip surface, secure attachment to arms. Test rotation.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Handle bars and arm levers',
      description: 'Check handles for grip condition, secure attachment, smooth movement without play.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Pivot and bearing mechanisms',
      description: 'Check all pivot points for wear, play, seizure, noise. Lubricate if needed.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Frame and structural condition',
      description: 'Check frame for corrosion, cracks, weld integrity, stability.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment and pinch points',
      description: 'Check all moving part junctions for finger/limb entrapment risk.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Foundation and fixings',
      description: 'Check base plate, ground fixings, ground erosion around posts.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'User information signage',
      description: 'Verify instruction signage is present, legible, and correct.',
      appliesTo: ['operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Pedal detachment during use',
      'Handle arm structural failure',
      'Entrapment at pivot point',
    ],
    high: [
      'Bearing seizure causing sudden stop',
      'Significant frame corrosion at joints',
      'Pedal crack affecting structural integrity',
    ],
    medium: [
      'Bearing noise (functional but worn)',
      'Pedal grip surface worn',
      'Surface rust on frame',
      'Signage missing',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
    'BS EN 16630:2015 §5 — User information requirements',
  ],
};

const LEG_PRESS: AssetTypeConfig = {
  key: 'leg_press',
  name: 'Leg Press',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Foot plate condition',
      description: 'Check foot plates for cracks, grip surface, secure mounting.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Seat and backrest',
      description: 'Check seat for damage, secure attachment, comfort padding condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Resistance mechanism',
      description: 'Check hydraulic/spring/weight resistance for smooth operation, no jamming.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Guide rails and track',
      description: 'Check guide rails for corrosion, smooth travel, no binding.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Pinch point protection',
      description: 'Check all moving part junctions for finger/limb entrapment covers.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Foundation and frame',
      description: 'Check base fixings, frame stability, corrosion at ground level.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Resistance mechanism failure (sudden release)',
      'Guide rail structural failure',
      'Entrapment at moving junctions',
    ],
    high: [
      'Seat detachment risk',
      'Foot plate loose',
      'Significant frame corrosion',
    ],
    medium: [
      'Resistance inconsistent but functional',
      'Seat padding deteriorated',
      'Surface rust on guide rails',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic damage',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
    'BS EN 16630:2015 §5 — User information requirements',
  ],
};

const CHEST_PRESS: AssetTypeConfig = {
  key: 'chest_press',
  name: 'Chest Press',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Push handles and arms',
      description: 'Check handles for grip, secure attachment. Test arm movement for smooth travel.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Seat and backrest',
      description: 'Check seat/backrest for damage, stability, secure mounting.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Resistance mechanism',
      description: 'Check resistance (body weight/hydraulic) for consistent, smooth operation.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Pivot and bearing points',
      description: 'Check all pivots for wear, play, lubrication needs.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Pinch point protection',
      description: 'Check moving arm junctions for entrapment risk.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and foundation',
      description: 'Check overall frame condition, base fixings, ground stability.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Arm mechanism failure during use',
      'Entrapment at pivot joints',
      'Structural frame failure',
    ],
    high: [
      'Handle detachment risk',
      'Seat structural damage',
      'Significant bearing failure',
    ],
    medium: [
      'Pivot noise (functional)',
      'Handle grip worn',
      'Surface corrosion',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
  ],
};

const LAT_PULLDOWN: AssetTypeConfig = {
  key: 'lat_pulldown',
  name: 'Lat Pull-Down',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Pull bar and handles',
      description: 'Check bar for bending, grip surface, handle attachment security.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Cable/chain mechanism',
      description: 'Check cable or chain for fraying, wear, kinks. Test smooth travel through pulleys.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Seat and thigh pad',
      description: 'Check seat is secure, thigh pad functional, padding condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Pulley mechanism',
      description: 'Check pulleys for wear, smooth rotation, cable tracking.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Weight stack / resistance',
      description: 'Check resistance mechanism for smooth, consistent operation.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and foundation',
      description: 'Check frame integrity, welds, base fixings, ground condition.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Cable/chain snap risk (>25% wear)',
      'Pulley failure causing sudden release',
      'Frame structural failure',
    ],
    high: [
      'Cable fraying visible',
      'Pull bar bending under load',
      'Seat detachment risk',
    ],
    medium: [
      'Cable surface wear (<25%)',
      'Pulley noise (functional)',
      'Seat padding worn',
    ],
    low: [
      'Paint wear',
      'Minor surface marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
  ],
};

const SIT_UP_BENCH: AssetTypeConfig = {
  key: 'sit_up_bench',
  name: 'Sit-Up Bench',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Bench surface and padding',
      description: 'Check bench surface for damage, grip, padding condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Foot/ankle restraint',
      description: 'Check foot bar or roller for security, padding, smooth operation.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Frame and incline mechanism',
      description: 'Check frame for corrosion, stability. If adjustable, test incline lock.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and fixings',
      description: 'Check ground fixings, base stability, erosion.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bench structural failure',
      'Foot restraint failure causing fall',
    ],
    high: [
      'Significant frame corrosion at joints',
      'Bench surface damage creating injury risk',
    ],
    medium: [
      'Padding worn or compressed',
      'Surface rust (cosmetic)',
      'Foot bar padding worn',
    ],
    low: [
      'Paint wear',
      'Minor surface marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
  ],
};

const EXERCISE_BIKE: AssetTypeConfig = {
  key: 'exercise_bike',
  name: 'Exercise Bike / Cycle',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Pedal condition',
      description: 'Check pedals for cracks, grip surface, bearings, secure attachment to crank.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Seat condition and adjustment',
      description: 'Check seat for damage, secure mounting. If adjustable, test lock mechanism.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Handle bars',
      description: 'Check for grip surface, secure mounting, no play in stem.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Drive/resistance mechanism',
      description: 'Check crank, chain/belt, flywheel for smooth operation, no binding.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment at crank/chain',
      description: 'Check chain guard or covers are intact. No entrapment at moving parts.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and foundation',
      description: 'Check frame stability, corrosion, base fixings.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Pedal detachment during use',
      'Crank failure',
      'Entrapment at drive mechanism',
    ],
    high: [
      'Seat clamp failure',
      'Chain/belt worn beyond safe limits',
      'Handle bar stem loose',
    ],
    medium: [
      'Pedal bearing worn',
      'Seat padding deteriorated',
      'Surface rust on frame',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic damage',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
  ],
};

const AIR_WALKER: AssetTypeConfig = {
  key: 'air_walker',
  name: 'Air Walker / Ski Walker',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Foot platform condition',
      description: 'Check foot platforms for grip surface, cracks, secure attachment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Swing arm mechanism',
      description: 'Check arm swing for smooth operation, no binding, adequate range limiting.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Handle bars',
      description: 'Check handles for grip, stability, secure mounting.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Pivot bearings',
      description: 'Check all pivot points for wear, play, noise, lubrication.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Entrapment at pivot points',
      description: 'Check all moving part junctions for finger/limb entrapment risk.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and foundation',
      description: 'Check frame integrity, base fixings, ground condition.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Foot platform detachment',
      'Swing arm failure',
      'Entrapment at pivot joint',
    ],
    high: [
      'Bearing seizure causing sudden stop',
      'Handle bar loose',
      'Significant frame corrosion',
    ],
    medium: [
      'Pivot bearing noise (functional)',
      'Platform grip surface worn',
      'Surface rust',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
  ],
};

const PARALLEL_BARS: AssetTypeConfig = {
  key: 'parallel_bars',
  name: 'Parallel Bars / Dip Station',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Bar condition and grip',
      description: 'Check bars for corrosion, bending, grip surface wear.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bar-to-frame connections',
      description: 'Check welds and fixings where bars meet uprights. No movement or cracking.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Frame uprights',
      description: 'Check uprights for corrosion, stability, plumb alignment.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and base',
      description: 'Check base fixings, ground erosion, concrete condition.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Surfacing beneath',
      description: 'Check surface condition for safe use beneath exercise area.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bar detachment or weld failure',
      'Frame collapse risk',
      'Sharp protrusion from damage',
    ],
    high: [
      'Bar bending under body weight',
      'Significant corrosion at joints',
      'Foundation movement',
    ],
    medium: [
      'Surface rust on bars (grip concern)',
      'Minor weld surface cracking',
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

const BODY_TWIST: AssetTypeConfig = {
  key: 'body_twist',
  name: 'Body Twist / Waist Twister',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Rotating platform',
      description: 'Check platform surface for grip, cracks, secure rotation.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bearing mechanism',
      description: 'Check rotation bearing for smooth action, wear, speed control.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Handle bars',
      description: 'Check handles for grip, stability, height suitability.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Entrapment beneath platform',
      description: 'Check gap between rotating platform and base for foot entrapment.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Frame and foundation',
      description: 'Check centre post, base fixings, ground condition.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Platform detachment from bearing',
      'Foot entrapment beneath rotating platform',
    ],
    high: [
      'Bearing failure causing sudden stop',
      'Handle bar loose or damaged',
    ],
    medium: [
      'Platform grip surface worn',
      'Bearing noise (functional)',
      'Surface corrosion',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
  ],
};

// ---- Custom: Outdoor Gym ----

const CUSTOM_OUTDOOR_GYM: AssetTypeConfig = {
  key: 'custom_outdoor_gym',
  name: 'Other Outdoor Gym Equipment',
  category: AssetCategory.OUTDOOR_GYM,
  complianceStandard: 'BS EN 16630:2015 (Permanently installed outdoor fitness equipment)',
  inspectionPoints: [
    {
      label: 'Overall structural condition',
      description: 'Check all frame members, joints, and welds for integrity and corrosion.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Moving parts and mechanisms',
      description: 'Check all moving parts for smooth operation, wear, seizure, lubrication.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Grip surfaces and contact points',
      description: 'Check all user contact surfaces for grip, damage, sharp edges.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Entrapment and pinch points',
      description: 'Check all moving part junctions for finger/limb entrapment risk.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Foundation and fixings',
      description: 'Check ground fixings, base stability, erosion.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'User information signage',
      description: 'Verify instruction signage is present, legible, and correct.',
      appliesTo: ['operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural failure or collapse risk',
      'Moving part detachment during use',
      'Entrapment at mechanism joints',
    ],
    high: [
      'Significant corrosion at load-bearing joints',
      'Mechanism seizure or malfunction',
      'Sharp edge from damage',
    ],
    medium: [
      'Surface rust (cosmetic)',
      'Bearing noise but functional',
      'Signage faded or missing',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 16630:2015 §4.2 — Structural requirements',
    'BS EN 16630:2015 §4.3 — Entrapment and pinch points',
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

// ---- NEW: Furniture additions ----

const LITTER_BIN: AssetTypeConfig = {
  key: 'litter_bin',
  name: 'Litter Bin',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Bin body condition',
      description: 'Check for cracks, holes, sharp edges, fire damage, vandalism.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Lid/flap mechanism',
      description: 'Check lid or flap operates correctly, no entrapment risk.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Mounting and stability',
      description: 'Check bin is securely mounted to post or ground. Not loose or tipping.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Post/stand condition',
      description: 'Check supporting post for corrosion, rot, stability.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Bin detached and fallen creating trip/impact hazard',
      'Sharp edge from fire or vandalism damage at child height',
    ],
    high: [
      'Bin loose — risk of detachment',
      'Significant sharp edge from damage',
    ],
    medium: [
      'Minor damage to body',
      'Lid mechanism stiff',
      'Surface corrosion on post',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic damage',
      'Graffiti',
    ],
  },
  bsEnDefectCategories: [],
};

const PICNIC_TABLE: AssetTypeConfig = {
  key: 'picnic_table',
  name: 'Picnic Table',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Table top condition',
      description: 'Check for splinters, cracks, rot (timber), sharp edges, stability.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Bench seat condition',
      description: 'Check seats for splinters, cracks, structural integrity, secure attachment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Frame and legs',
      description: 'Check frame for corrosion (metal), rot (timber), stability. No rocking.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Fixings and connections',
      description: 'Check all bolts, brackets, and connections for tightness and condition.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation/anchoring',
      description: 'Check table is anchored securely, level, no ground erosion.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural collapse risk (seat or table)',
      'Exposed nails/screws causing laceration',
    ],
    high: [
      'Seat slat broken creating fall-through risk',
      'Table top structural crack',
      'Significant rot affecting load-bearing members',
    ],
    medium: [
      'Minor splinter risk',
      'Surface corrosion on frame',
      'Loose slat or plank',
    ],
    low: [
      'Paint wear',
      'Weathering',
      'Graffiti',
    ],
  },
  bsEnDefectCategories: [],
};

const SHELTER: AssetTypeConfig = {
  key: 'shelter',
  name: 'Shelter / Canopy',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Roof/canopy condition',
      description: 'Check for damage, leaks, loose panels, sagging. Verify no water pooling.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Supporting posts and columns',
      description: 'Check all supports for corrosion, rot, stability, plumb alignment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Wall panels / screens (if fitted)',
      description: 'Check panels for damage, sharp edges, security.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Guttering and drainage',
      description: 'Check gutters for blockage, damage, overflow causing ground erosion.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation condition',
      description: 'Check base fixings, concrete pad, ground erosion around posts.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Seating within shelter (if fitted)',
      description: 'Check any integral seating for condition and safety.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Roof collapse risk',
      'Support post structural failure',
      'Loose roof panel in high wind',
    ],
    high: [
      'Significant post corrosion/rot at base',
      'Roof panel partially detached',
      'Sharp edge from panel damage at head height',
    ],
    medium: [
      'Minor roof leak',
      'Gutter blockage',
      'Surface corrosion on posts',
    ],
    low: [
      'Paint wear',
      'Minor graffiti',
      'Cosmetic panel damage',
    ],
  },
  bsEnDefectCategories: [],
};

// ---- Custom: Furniture ----

const CUSTOM_FURNITURE: AssetTypeConfig = {
  key: 'custom_furniture',
  name: 'Other Furniture / Site Feature',
  category: AssetCategory.FURNITURE,
  complianceStandard: 'General duty of care',
  inspectionPoints: [
    {
      label: 'Overall structural condition',
      description: 'Check all structural members for integrity, stability, damage.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Surface condition and sharp edges',
      description: 'Check all surfaces for damage, splinters, sharp edges, protrusions.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Fixings and connections',
      description: 'Check all bolts, screws, and fixings for tightness and condition.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and stability',
      description: 'Check item is securely fixed, stable, level.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Structural collapse risk',
      'Sharp edge causing laceration risk',
    ],
    high: [
      'Significant structural damage',
      'Item loose or unstable',
    ],
    medium: [
      'Minor structural wear',
      'Surface corrosion or rot',
    ],
    low: [
      'Cosmetic wear',
      'Minor weathering',
    ],
  },
  bsEnDefectCategories: [],
};

// =============================================
// SPORTS EQUIPMENT
// =============================================

const BASKETBALL_HOOP: AssetTypeConfig = {
  key: 'basketball_hoop',
  name: 'Basketball Hoop / Post',
  category: AssetCategory.SPORTS,
  complianceStandard: 'BS EN 1270:2006 (Playing field equipment — Basketball equipment)',
  inspectionPoints: [
    {
      label: 'Backboard condition',
      description: 'Check backboard for cracks, delamination, secure mounting to post.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Ring/hoop and net',
      description: 'Check ring attachment is secure, no bending. Check net condition.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Post/pole condition',
      description: 'Check post for corrosion, bending, weld integrity, plumb alignment.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and base',
      description: 'Check foundation for exposed concrete, cracking, ground erosion. No movement.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Surfacing beneath',
      description: 'Check playing surface condition in the immediate area.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Backboard detachment risk',
      'Post structural failure or severe lean',
      'Ring attachment failure (falling hazard)',
    ],
    high: [
      'Backboard cracked (falling debris risk)',
      'Post corrosion at base (structural)',
      'Exposed foundation creating trip hazard',
    ],
    medium: [
      'Ring slightly bent',
      'Net torn or missing',
      'Surface corrosion on post',
    ],
    low: [
      'Paint wear',
      'Net fraying',
      'Minor cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1270:2006 §4 — Stability and structural requirements',
    'BS EN 1270:2006 §5 — Backboard attachment requirements',
  ],
};

const FOOTBALL_GOAL: AssetTypeConfig = {
  key: 'football_goal',
  name: 'Football Goal',
  category: AssetCategory.SPORTS,
  complianceStandard: 'BS EN 748:2013 (Playing field equipment — Football goals)',
  inspectionPoints: [
    {
      label: 'Frame condition (posts and crossbar)',
      description: 'Check posts and crossbar for corrosion, bending, weld cracks, dents.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Net and net fixings',
      description: 'Check net for tears, holes, secure attachment to frame. Verify net hooks/clips.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Stability and anchorage',
      description: 'CRITICAL: Verify goal is anchored per BS EN 748. Test stability — must not tip forward. Check ground sockets, back bars, or weights.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Ground socket condition (if fitted)',
      description: 'Check sockets for damage, correct depth, lid/cap condition when not in use.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Wheel mechanism (if portable)',
      description: 'Check wheels, locking mechanism, transport safety.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Sharp edges and protrusions',
      description: 'Check all joints, fixings, and net hooks for sharp edges.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Goal not anchored — tipping/toppling risk (life-threatening)',
      'Crossbar structural failure',
      'Post collapse or severe corrosion at base',
    ],
    high: [
      'Anchor mechanism damaged or missing',
      'Significant weld crack on frame',
      'Sharp protrusion at head height',
    ],
    medium: [
      'Net torn or partially detached',
      'Surface corrosion on frame',
      'Ground socket cap missing',
    ],
    low: [
      'Paint wear',
      'Minor net fraying',
      'Cosmetic dents',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 748:2013 §4.1 — Structural strength requirements',
    'BS EN 748:2013 §4.2 — Stability requirements (anchoring)',
    'BS EN 748:2013 §4.4 — Protrusion requirements',
  ],
};

const TENNIS_NET: AssetTypeConfig = {
  key: 'tennis_net',
  name: 'Tennis Net / MUGA Net Post',
  category: AssetCategory.SPORTS,
  complianceStandard: 'BS EN 1510:2017 (Playing field equipment — Badminton, tennis, and similar net equipment)',
  inspectionPoints: [
    {
      label: 'Net condition',
      description: 'Check net for tears, holes, sagging, UV degradation. Verify correct height.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Net posts',
      description: 'Check posts for corrosion, bending, stability, plumb alignment.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Tensioning mechanism',
      description: 'Check winder, ratchet, or cleat for function. Verify net tension correct.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Ground sockets (if removable posts)',
      description: 'Check sockets for damage, correct depth, caps when not in use.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Cable/cord condition',
      description: 'Check headband cable and lower cord for fraying, corrosion, tension.',
      appliesTo: ['annual_main'],
    },
    {
      label: 'Sharp edges on post fittings',
      description: 'Check all hooks, clamps, and winder mechanism for sharp edges.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Post structural failure or collapse risk',
      'Sharp protrusion at face/head height',
    ],
    high: [
      'Post base severe corrosion',
      'Tensioning mechanism failure (wire snap risk)',
      'Socket trip hazard (cap missing, raised edge)',
    ],
    medium: [
      'Net sagging below correct height',
      'Surface corrosion on posts',
      'Winder mechanism stiff',
    ],
    low: [
      'Net minor fraying',
      'Paint wear on posts',
      'Cosmetic marks',
    ],
  },
  bsEnDefectCategories: [
    'BS EN 1510:2017 §4.2 — Structural requirements',
    'BS EN 1510:2017 §4.3 — Post socket requirements',
    'BS EN 1510:2017 §4.5 — Tensioning device requirements',
  ],
};

// ---- Custom: Sports ----

const CUSTOM_SPORTS: AssetTypeConfig = {
  key: 'custom_sports',
  name: 'Other Sports Equipment',
  category: AssetCategory.SPORTS,
  complianceStandard: 'General duty of care / applicable BS EN standard',
  inspectionPoints: [
    {
      label: 'Overall structural condition',
      description: 'Check all structural members, posts, frames for integrity and corrosion.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Stability and anchorage',
      description: 'CRITICAL: Verify equipment is securely anchored. Test stability — no tipping risk.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Nets, mesh, and attachments',
      description: 'Check any nets or mesh for condition, secure attachment, correct tension.',
      appliesTo: ['routine_visual', 'operational', 'annual_main'],
    },
    {
      label: 'Sharp edges and protrusions',
      description: 'Check all joints, fixings, and fittings for sharp edges at user height.',
      appliesTo: ['operational', 'annual_main'],
    },
    {
      label: 'Foundation and ground condition',
      description: 'Check foundations, ground sockets, surrounding surface condition.',
      appliesTo: ['annual_main'],
    },
  ],
  riskCriteria: {
    very_high: [
      'Equipment not anchored — tipping risk',
      'Structural failure or collapse risk',
      'Sharp protrusion at head/face height',
    ],
    high: [
      'Significant structural corrosion',
      'Anchor mechanism damaged or missing',
      'Foundation trip hazard',
    ],
    medium: [
      'Surface corrosion',
      'Net/mesh damage',
      'Ground socket cap missing',
    ],
    low: [
      'Paint wear',
      'Minor cosmetic damage',
    ],
  },
  bsEnDefectCategories: [],
};

// =============================================
// MASTER CONFIGURATION REGISTRY
// =============================================

export const ASSET_TYPE_CONFIG: Record<string, AssetTypeConfig> = {
  // Playground (12 original + 4 new + 1 custom = 17)
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
  spinner_bowl: SPINNER_BOWL,
  in_ground_trampoline: IN_GROUND_TRAMPOLINE,
  tunnel: TUNNEL,
  playhouse: PLAYHOUSE,
  custom_playground: CUSTOM_PLAYGROUND,

  // Outdoor Gym (1 original + 9 new + 1 custom = 11)
  pull_up_bar: PULL_UP_BAR,
  cross_trainer: CROSS_TRAINER,
  leg_press: LEG_PRESS,
  chest_press: CHEST_PRESS,
  lat_pulldown: LAT_PULLDOWN,
  sit_up_bench: SIT_UP_BENCH,
  exercise_bike: EXERCISE_BIKE,
  air_walker: AIR_WALKER,
  parallel_bars: PARALLEL_BARS,
  body_twist: BODY_TWIST,
  custom_outdoor_gym: CUSTOM_OUTDOOR_GYM,

  // Furniture (3 original + 3 new + 1 custom = 7)
  bench: BENCH,
  gate: GATE,
  fence: FENCE,
  litter_bin: LITTER_BIN,
  picnic_table: PICNIC_TABLE,
  shelter: SHELTER,
  custom_furniture: CUSTOM_FURNITURE,

  // Sports (3 new + 1 custom = 4)
  basketball_hoop: BASKETBALL_HOOP,
  football_goal: FOOTBALL_GOAL,
  tennis_net: TENNIS_NET,
  custom_sports: CUSTOM_SPORTS,
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
