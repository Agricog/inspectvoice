/**
 * InspectVoice — Page Help Content
 * Centralised help text for every page in the application.
 *
 * Each entry provides:
 *   - title: Page name shown in the help panel header
 *   - summary: One-line description of what the page does
 *   - sections: Step-by-step usage instructions grouped by topic
 *
 * To add help for a new page, add a new key to PAGE_HELP_CONTENT.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

// =============================================
// TYPES
// =============================================

export interface HelpSection {
  heading: string;
  items: string[];
}

export interface PageHelpContent {
  title: string;
  summary: string;
  sections: HelpSection[];
}

export type PageHelpKey =
  | 'dashboard'
  | 'sites'
  | 'siteDetail'
  | 'siteForm'
  | 'assetForm'
  | 'assetDetail'
  | 'inspectionStart'
  | 'inspectionCapture'
  | 'inspectionReview'
  | 'inspectionList'
  | 'defectTracker'
  | 'incidents'
  | 'incidentForm'
  | 'sealedExports'
  | 'normalisationHistory'
  | 'settings'
  | 'routePlanner'
  | 'inspectorPerformance'
  | 'myPerformance'
  | 'defectLibrary'
  | 'recalls';

// =============================================
// HELP CONTENT
// =============================================

export const PAGE_HELP_CONTENT: Record<PageHelpKey, PageHelpContent> = {
  // ── Dashboard ──
  dashboard: {
    title: 'Dashboard',
    summary: 'Your overview of all inspection activity, outstanding actions, and key metrics at a glance.',
    sections: [
      {
        heading: 'What You See',
        items: [
          'Active sites count and total assets under management.',
          'Upcoming and overdue inspections requiring attention.',
          'Outstanding defects grouped by risk rating (Very High, High, Medium, Low).',
          'Recent inspection activity and completion rates.',
        ],
      },
      {
        heading: 'How to Use',
        items: [
          'Click any metric card to jump directly to the relevant page (e.g. tap overdue inspections to see the full list).',
          'Use the dashboard as your daily starting point to prioritise work.',
          'Data refreshes each time you visit — pull down on mobile to refresh.',
        ],
      },
    ],
  },

  // ── Sites List ──
  sites: {
    title: 'Sites',
    summary: 'View, search, and manage all your inspection sites — parks, playgrounds, outdoor gyms, and recreation areas.',
    sections: [
      {
        heading: 'Browsing Sites',
        items: [
          'All your sites are listed with their name, address, type, and status.',
          'Use the search bar to find sites by name, address, postcode, or site code.',
          'Tap the Filters button to narrow by site type (Playground, Park, Outdoor Gym) or status (Active, Archived, Temporary Closure).',
          'Change sort order between alphabetical, recently updated, or by type.',
        ],
      },
      {
        heading: 'Adding a Site',
        items: [
          'Tap the "+ Add Site" button in the top right.',
          'Fill in the site details: name, address, postcode, type, and contact information.',
          'The site is saved locally and syncs to the server when you are online.',
        ],
      },
      {
        heading: 'Opening a Site',
        items: [
          'Tap any site row to open its detail page.',
          'From there you can view and manage its asset register, start inspections, and see inspection history.',
        ],
      },
    ],
  },

  // ── Site Detail ──
  siteDetail: {
    title: 'Site Detail',
    summary: 'Everything about a single site — its asset register, inspection history, and site information.',
    sections: [
      {
        heading: 'Asset Register',
        items: [
          'The asset register lists all equipment at this site (swings, slides, climbing frames, etc.).',
          'Each asset shows its code, type, condition from the last inspection, and active/inactive status.',
          'Tap an asset to view its full detail and inspection history.',
          'Use "+ Add Asset" to register new equipment.',
        ],
      },
      {
        heading: 'Starting an Inspection',
        items: [
          'Tap "Start Inspection" to begin a new inspection for this site.',
          'Choose the inspection type: Routine Visual, Operational, or Annual Main.',
          'The inspection will cover every active asset in the register.',
        ],
      },
      {
        heading: 'Site Management',
        items: [
          'Tap "Edit" to update site details (address, contact, type).',
          'View past inspections in the inspection history section.',
          'Sites can be archived or marked as temporarily closed.',
        ],
      },
    ],
  },

  // ── Site Form ──
  siteForm: {
    title: 'Add / Edit Site',
    summary: 'Create a new inspection site or update an existing one.',
    sections: [
      {
        heading: 'Required Fields',
        items: [
          'Site Name — a clear, recognisable name (e.g. "Riverside Park Playground").',
          'Address — full street address for the site.',
          'Site Type — select from Playground, Park, Outdoor Gym, Mixed, or Other.',
        ],
      },
      {
        heading: 'Optional Fields',
        items: [
          'Postcode — helps with route planning and site identification.',
          'Site Code — your internal reference code (e.g. council reference).',
          'Contact details — site manager name, phone, and email.',
          'Latitude and Longitude — used for mapping and route planning.',
          'Notes — any additional information about the site.',
        ],
      },
      {
        heading: 'Saving',
        items: [
          'Tap "Save" to store the site. It saves locally first and syncs when online.',
          'All fields are validated before saving — fix any red error messages before submitting.',
        ],
      },
    ],
  },

  // ── Asset Form ──
  assetForm: {
    title: 'Add / Edit Asset',
    summary: 'Register a piece of equipment in a site\'s asset register, or update its details.',
    sections: [
      {
        heading: 'Identification',
        items: [
          'Select a Category first (Playground, Outdoor Gym, Furniture, Sports, Other).',
          'Then choose the Asset Type from the dropdown — this determines the BS EN compliance standard and inspection checklist.',
          'If you select "Custom" or the "Other" category, type in the equipment name manually.',
          'Asset Code is auto-suggested (e.g. SWING-001) but can be changed.',
        ],
      },
      {
        heading: 'Manufacturer Details',
        items: [
          'Record the manufacturer, model, and serial number for audit trail and recall matching.',
          'Install date and purchase cost are optional but useful for lifecycle management.',
          'Expected lifespan helps predict replacement timelines.',
        ],
      },
      {
        heading: 'Safety Measurements',
        items: [
          'Only shown for Playground and Outdoor Gym assets.',
          'Critical Fall Height (mm) — the maximum free fall height per BS EN 1176-1.',
          'Impact Surface Type — the safety surfacing material (wet pour, rubber tiles, bark, etc.).',
          'Required Surfacing Depth — minimum depth for impact absorption per BS EN 1177.',
        ],
      },
      {
        heading: 'Status',
        items: [
          'Toggle active/inactive. Inactive assets are excluded from inspections.',
          'Use this when equipment is temporarily removed or awaiting replacement.',
        ],
      },
    ],
  },

  // ── Asset Detail ──
  assetDetail: {
    title: 'Asset Detail',
    summary: 'Full information about a single piece of equipment — specifications, condition history, and inspection records.',
    sections: [
      {
        heading: 'What You See',
        items: [
          'Asset specifications: type, manufacturer, model, serial number, install date.',
          'Current condition rating from the most recent inspection.',
          'Condition trend (improving, stable, declining) based on inspection history.',
          'Baseline reference photo for comparison during inspections.',
          'Safety measurements (fall height, surface type) for playground equipment.',
        ],
      },
      {
        heading: 'How to Use',
        items: [
          'Tap "Edit" to update asset details.',
          'Review inspection history to track condition changes over time.',
          'The baseline photo is set during inspections and shows up for comparison on future visits.',
        ],
      },
    ],
  },

  // ── Inspection Start ──
  inspectionStart: {
    title: 'Start Inspection',
    summary: 'Choose the inspection type and begin inspecting all assets at this site.',
    sections: [
      {
        heading: 'Inspection Types',
        items: [
          'Routine Visual — quick daily/weekly checks for obvious hazards. Covers visible condition, cleanliness, and immediate safety.',
          'Operational — more detailed checks including moving parts, fixings, stability, and wear. Typically monthly.',
          'Annual Main — comprehensive annual inspection covering all BS EN 1176 requirements. Most thorough inspection type.',
        ],
      },
      {
        heading: 'Starting',
        items: [
          'Select the inspection type that matches your visit purpose.',
          'The inspection will automatically include every active asset in the site register.',
          'You can add notes or skip assets during the capture phase.',
          'Tap "Start Inspection" to proceed to the capture workflow.',
        ],
      },
    ],
  },

  // ── Inspection Capture ──
  inspectionCapture: {
    title: 'Inspection Capture',
    summary: 'The core inspection workflow — record your findings for each asset using voice, photos, and manual input.',
    sections: [
      {
        heading: 'Navigation',
        items: [
          'Assets are shown one at a time. Use the stepper dots at the top to jump between them.',
          'Green dots = completed, current dot = highlighted, grey dots = not yet inspected.',
          'Use Previous/Next buttons or tap dots directly to navigate.',
          'The progress bar shows how many assets you have completed.',
        ],
      },
      {
        heading: 'Checklist',
        items: [
          'Each asset type has a BS EN compliance checklist tailored to the inspection type.',
          'Tick items as you inspect them. You can dismiss items that don\'t apply.',
          'Add custom check items using "+ Add Custom Check" for anything not on the standard list.',
        ],
      },
      {
        heading: 'Voice Recording',
        items: [
          'Tap "Record" to dictate your findings hands-free.',
          'Speak clearly — describe what you see, any defects, and their severity.',
          'Pause/Resume as needed. Tap "Stop" when finished.',
          'The transcript appears below the recording controls.',
          'You can clear and re-record if needed.',
        ],
      },
      {
        heading: 'Photos',
        items: [
          'Tap "Take Photo" to capture evidence using your device camera.',
          'Take multiple photos per asset — close-ups of defects, wide shots for context.',
          'Photos are compressed and stored locally, then synced to the server.',
          'GPS coordinates are automatically captured from the photo or your device location.',
          'You can set any photo as the baseline reference for future inspections.',
        ],
      },
      {
        heading: 'Defects',
        items: [
          'Tap "Common Defects" to pick from the defect library — pre-written descriptions with BS EN references.',
          'Each defect includes a risk rating, remedial action, and timeframe.',
          'You can edit any defect details after adding them.',
          'Add multiple defects per asset if needed.',
        ],
      },
      {
        heading: 'Condition Rating',
        items: [
          'Rate the overall condition: Good, Fair, Poor, or Dangerous.',
          'This rating feeds into trend analysis and dashboard metrics.',
        ],
      },
      {
        heading: 'Saving',
        items: [
          'Tap "Save & Continue" to save your findings and move to the next asset.',
          'You can go back and update previously saved assets at any time.',
          'When all assets are completed, tap "Finish & Review" to proceed.',
        ],
      },
    ],
  },

  // ── Inspection Review ──
  inspectionReview: {
    title: 'Inspection Review',
    summary: 'Review all captured data, confirm findings, and sign off the inspection to generate the final report.',
    sections: [
      {
        heading: 'Reviewing',
        items: [
          'Every asset and its findings are listed for your review.',
          'Check condition ratings, defects, notes, and photos are accurate.',
          'You can go back to the capture screen to make corrections before signing off.',
        ],
      },
      {
        heading: 'Signing Off',
        items: [
          'Once satisfied, sign the inspection to lock it as immutable.',
          'A signed inspection cannot be edited — this ensures audit integrity.',
          'After signing, a professional BS EN 1176-compliant PDF report is generated.',
          'The report can be downloaded, shared, or accessed via the client portal.',
        ],
      },
    ],
  },

  // ── Inspection List ──
  inspectionList: {
    title: 'Inspections',
    summary: 'View all inspections across all sites — filter by status, type, date, and site.',
    sections: [
      {
        heading: 'Browsing',
        items: [
          'All inspections are listed with their site, type, date, status, and inspector.',
          'Filter by status: Draft, In Progress, Completed, Signed.',
          'Filter by inspection type: Routine Visual, Operational, Annual Main.',
          'Search by site name or inspection reference.',
        ],
      },
      {
        heading: 'Actions',
        items: [
          'Tap any inspection to view its details or continue if still in progress.',
          'Signed inspections can be viewed but not edited.',
          'Download PDF reports for completed and signed inspections.',
        ],
      },
    ],
  },

  // ── Defect Tracker ──
  defectTracker: {
    title: 'Defect Tracker',
    summary: 'Track all open defects across all sites — prioritised by risk rating with remedial actions and timeframes.',
    sections: [
      {
        heading: 'Overview',
        items: [
          'All defects from inspections are listed here, grouped or filtered by risk rating.',
          'Very High and High risk defects appear at the top for immediate attention.',
          'Each defect shows: description, BS EN reference, risk rating, remedial action, timeframe, and which asset/site it belongs to.',
        ],
      },
      {
        heading: 'Managing Defects',
        items: [
          'Use filters to focus on specific risk levels, sites, or timeframes.',
          'Track which defects have been actioned and which are outstanding.',
          'Defects feed into the dashboard metrics and performance analytics.',
        ],
      },
    ],
  },

  // ── Incidents ──
  incidents: {
    title: 'Incidents',
    summary: 'Record and manage safety incidents, accidents, and near-misses at your sites.',
    sections: [
      {
        heading: 'Viewing Incidents',
        items: [
          'All recorded incidents are listed with date, site, severity, and status.',
          'Filter and search to find specific incidents.',
        ],
      },
      {
        heading: 'Reporting an Incident',
        items: [
          'Tap "+ New Incident" to record a new incident.',
          'Fill in the details: what happened, when, where, severity, and any injuries.',
          'Attach photos as evidence.',
          'Incidents are linked to sites and can be referenced in inspection reports.',
        ],
      },
    ],
  },

  // ── Incident Form ──
  incidentForm: {
    title: 'Report Incident',
    summary: 'Record the details of a safety incident, accident, or near-miss.',
    sections: [
      {
        heading: 'Required Information',
        items: [
          'Select the site where the incident occurred.',
          'Date and time of the incident.',
          'Description of what happened.',
          'Severity level: Minor, Moderate, Serious, or Critical.',
        ],
      },
      {
        heading: 'Additional Details',
        items: [
          'Record any injuries and whether medical attention was required.',
          'Note the equipment/asset involved if applicable.',
          'Attach photos of the scene or damage.',
          'Record witness details and any immediate actions taken.',
          'Add follow-up actions required.',
        ],
      },
    ],
  },

  // ── Sealed Exports ──
  sealedExports: {
    title: 'Sealed Exports',
    summary: 'Tamper-proof, digitally signed inspection report bundles for legal and insurance purposes.',
    sections: [
      {
        heading: 'What Are Sealed Exports?',
        items: [
          'A sealed export is a cryptographically signed bundle containing the inspection report, photos, and metadata.',
          'The digital signature proves the report has not been tampered with since it was signed.',
          'Councils, insurers, and solicitors can verify authenticity using the verification link.',
        ],
      },
      {
        heading: 'How to Use',
        items: [
          'Sealed exports are generated automatically when an inspection is signed off.',
          'Each export has a unique verification URL that anyone can use to check authenticity.',
          'Download sealed bundles for your records or share the verification link with third parties.',
        ],
      },
    ],
  },

  // ── Normalisation History ──
  normalisationHistory: {
    title: 'Normalisation History',
    summary: 'View the history of AI-powered style normalisation applied to inspection reports.',
    sections: [
      {
        heading: 'What Is Normalisation?',
        items: [
          'Normalisation ensures all inspection reports use consistent, professional language regardless of which inspector wrote them.',
          'AI analyses voice transcripts and notes, then standardises terminology, grammar, and formatting.',
          'The original text is always preserved — normalisation adds a cleaned version alongside it.',
        ],
      },
      {
        heading: 'Viewing History',
        items: [
          'Each normalisation shows the before/after text, which inspection it belongs to, and when it was processed.',
          'Use this page to review and verify AI normalisation quality.',
        ],
      },
    ],
  },

  // ── Settings ──
  settings: {
    title: 'Settings',
    summary: 'Manage your account, organisation, preferences, and application data.',
    sections: [
      {
        heading: 'Account',
        items: [
          'View and update your profile information.',
          'Manage your organisation membership.',
          'Sign out of the application.',
        ],
      },
      {
        heading: 'Data Management',
        items: [
          'View offline storage usage (photos, audio, inspections cached locally).',
          'Clear local cache if you need to free up device storage.',
          'Sync status shows whether all data has been uploaded to the server.',
        ],
      },
    ],
  },

  // ── Route Planner ──
  routePlanner: {
    title: 'Route Planner',
    summary: 'Plan efficient inspection routes across multiple sites using interactive mapping.',
    sections: [
      {
        heading: 'Planning a Route',
        items: [
          'All your sites are shown as pins on the map.',
          'Select the sites you want to visit by tapping their pins or selecting from the list.',
          'The planner calculates the most efficient route between selected sites.',
          'Drag and drop sites in the list to reorder your route manually.',
        ],
      },
      {
        heading: 'Using the Map',
        items: [
          'Zoom and pan to see your sites across different areas.',
          'Site pins are colour-coded by type or inspection status.',
          'Tap a pin to see site details and add/remove it from your route.',
          'The route line shows driving directions between stops.',
        ],
      },
    ],
  },

  // ── Inspector Performance ──
  inspectorPerformance: {
    title: 'Inspector Performance',
    summary: 'Manager view of inspector productivity, quality metrics, and trends across your team.',
    sections: [
      {
        heading: 'Overview',
        items: [
          'See all inspectors in your organisation with their key metrics.',
          'Metrics include: inspections completed, average time per inspection, defect detection rate, and quality scores.',
          'Filter by date range to analyse specific periods.',
        ],
      },
      {
        heading: 'Inspector Detail',
        items: [
          'Tap any inspector to see their detailed performance breakdown.',
          'View trends over time — are they getting faster, finding more defects, improving quality?',
          'Compare individual performance against team averages.',
        ],
      },
    ],
  },

  // ── My Performance ──
  myPerformance: {
    title: 'My Performance',
    summary: 'Your personal inspection metrics, trends, and achievements.',
    sections: [
      {
        heading: 'Your Metrics',
        items: [
          'See your total inspections, average completion time, and defect detection rate.',
          'Track your quality score based on report completeness and consistency.',
          'View your trends over time to see how you are improving.',
        ],
      },
      {
        heading: 'Sharing',
        items: [
          'Generate a shareable performance report link for CPD evidence or employer review.',
          'The shared link is read-only and time-limited for security.',
        ],
      },
    ],
  },

  // ── Defect Library ──
  defectLibrary: {
    title: 'Defect Library',
    summary: 'A reference library of common playground defects with BS EN references, risk ratings, and remedial actions.',
    sections: [
      {
        heading: 'Browsing the Library',
        items: [
          'Defects are organised by asset type (swings, slides, climbing frames, etc.).',
          'Each entry includes a description, BS EN 1176 clause reference, risk rating, and suggested remedial action.',
          'Search by keyword or filter by asset type and risk level.',
        ],
      },
      {
        heading: 'Using During Inspections',
        items: [
          'During an inspection, tap "Common Defects" on the capture screen.',
          'This opens the library filtered to the current asset type.',
          'Tap a defect to add it to the inspection — you can then customise the description and fill in any details.',
          'The library saves time and ensures consistent BS EN referencing across all inspectors.',
        ],
      },
    ],
  },

  // ── Manufacturer Recalls ──
  recalls: {
    title: 'Manufacturer Recalls',
    summary: 'Track manufacturer safety recalls and check which of your assets are affected.',
    sections: [
      {
        heading: 'Viewing Recalls',
        items: [
          'All recorded manufacturer recalls are listed with severity, affected models, and publication date.',
          'Recalls are automatically matched against your asset register by manufacturer and model.',
          'Affected assets are flagged with a recall warning on their detail page and during inspections.',
        ],
      },
      {
        heading: 'Managing Recalls',
        items: [
          'Add new recalls manually when you receive a manufacturer notice.',
          'For each affected asset, record the action taken: inspected, withdrawn, replaced, or confirmed not affected.',
          'All acknowledgements are audit-trailed for compliance evidence.',
          'Active recalls are included in summary email digests.',
        ],
      },
    ],
  },
};
