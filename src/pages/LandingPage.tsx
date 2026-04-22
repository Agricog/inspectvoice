/**
 * InspectVoice — SEO Landing Page
 * src/pages/LandingPage.tsx
 *
 * Route: / (unauthenticated visitors, SSG pre-rendered)
 *
 * Full Autaimate Build Standard v3 SEO compliance:
 * - 15-point SEO Achievement Framework
 * - 8 JSON-LD schemas (@graph)
 * - 2,500+ words educational content
 * - 12 FAQ blocks with schema
 * - Quick Answer Box (voice search optimised)
 * - Internal linking to product sections
 * - H1 → H2 → H3 hierarchy
 * - Pre-rendered to static HTML via vite-react-ssg for crawler access
 *
 * UPDATED: March 2026 — reflects all built features.
 * UPDATED: April 2026 — migrated from react-helmet-async <Helmet> to
 *   vite-react-ssg <Head> so meta tags are injected into pre-rendered HTML
 *   at build time. Fixed duplicate id="contact" (CTA -> "get-started").
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState } from 'react';
import { Head } from 'vite-react-ssg';
import { Link } from 'react-router-dom';
import {
  Mic,
  Shield,
  FileText,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  BarChart3,
  Camera,
  Users,
  MapPin,
  Smartphone,
  Zap,
  Lock,
  ArrowRight,
  Navigation,
  BookOpen,
  History,
  Sun,
  Printer,
} from 'lucide-react';

// =============================================
// SEO DATA
// =============================================

const SITE_URL = 'https://inspectvoice.co.uk';
const OG_IMAGE = `${SITE_URL}/og-inspectvoice.jpg`;

const PAGE_TITLE = 'InspectVoice — AI Voice-Powered Playground Inspection Software UK | BS EN 1176';
const PAGE_DESCRIPTION =
  'Voice-driven playground inspection software for UK inspectors and councils. BS EN 1176/1177 compliant, AI-powered defect capture, previous findings carry-forward, route planning, and signed PDF reports on site. From £99/month.';

// =============================================
// FAQ DATA (defined before JSON_LD_GRAPH which references it)
// =============================================

const FAQ_DATA = [
  {
    question: 'What is InspectVoice and how does it work?',
    answer:
      'InspectVoice is a voice-driven AI inspection platform designed specifically for UK playground safety inspections. Inspectors speak their observations while walking a site, and the AI transcribes, categorises severity levels, maps findings to BS EN 1176 references, and generates a signed PDF report before the inspector leaves site. It replaces paper forms, manual data entry, and office write-up entirely.',
  },
  {
    question: 'Is InspectVoice compliant with BS EN 1176 and BS EN 1177?',
    answer:
      'Yes. InspectVoice is built around the full BS EN 1176 (Parts 1–11) and BS EN 1177 framework. The inspection checklist is pre-populated with the standard clause references, severity classifications align with industry practice (very high, high, medium, low, advisory), and all reports include the relevant BS EN references for every finding.',
  },
  {
    question: 'Who is InspectVoice designed for?',
    answer:
      'InspectVoice is designed for private playground inspection companies, UK local authority councils, housing associations, academy trusts, and any organisation responsible for maintaining playground equipment. It serves RPII-registered inspectors, parks managers, health and safety officers, and facilities management teams.',
  },
  {
    question: 'How does voice-driven inspection capture save time?',
    answer:
      'Traditional playground inspections require writing notes on paper or typing into forms, then transferring findings to a report back at the office. InspectVoice eliminates this double-handling entirely. Inspectors speak naturally while walking the site, the AI extracts structured defects with BS EN references, and a signed PDF report is ready before they reach the van. What used to take a 30-minute site visit plus 30–60 minutes of office admin now takes just the site visit.',
  },
  {
    question: 'What happens when a high-severity defect is found?',
    answer:
      'When a very high or high severity defect is recorded, InspectVoice adds it to the priority hotlist immediately. The defect appears on the manager dashboard with severity badge, site location, asset details, and days open. If the defect was also reported on previous inspections, it is flagged as recurring with the number of consecutive visits it has been open — critical evidence for demonstrating due diligence.',
  },
  {
    question: 'Do previous defects carry forward between inspections?',
    answer:
      'Yes. When an inspector starts capturing an asset, InspectVoice automatically pulls all unresolved defects from previous inspections on that equipment. Each one appears with the full original detail — description, BS EN reference, risk rating, remedial action. The inspector marks each as Resolved, Still Present, or Worsened. Still Present and Worsened defects carry into the new report with a recurring flag and a count of how many visits the defect has been open. This creates an auditable trail proving the defect was reported and not addressed.',
  },
  {
    question: 'Can InspectVoice track manufacturer recalls on playground equipment?',
    answer:
      'Yes. InspectVoice includes a manufacturer recall management system. When a recall is entered, the deterministic matching engine scans your asset register and identifies affected equipment automatically. Matched assets show recall warnings on their detail pages.',
  },
  {
    question: 'How does InspectVoice handle multiple sites?',
    answer:
      'InspectVoice supports unlimited sites within an organisation. Each site has its own asset register, inspection schedule, and defect history. The route planner optimises your daily inspection route with turn-by-turn directions between sites, and the manager dashboard provides a cross-site overview with the priority hotlist and compliance statistics.',
  },
  {
    question: 'Is the data legally defensible for insurance and litigation purposes?',
    answer:
      'Yes. Every inspection, defect, and action is timestamped, attributed to the logged-in user, and stored in an immutable audit log. Photo evidence is geotagged and timestamped. Previous findings carry-forward creates a documented history showing when defects were first reported and how many inspections they remained unresolved. Sealed exports with cryptographic verification ensure reports cannot be tampered with after the fact. This audit trail is designed to withstand scrutiny in legal proceedings and insurance claims.',
  },
  {
    question: 'Does InspectVoice work offline or in areas with poor signal?',
    answer:
      'InspectVoice is built as a progressive web app (PWA) with full offline capability. The app loads from cache even without any network connection, using a cached authentication session so inspectors can start working immediately. Inspections capture voice, photos, checklists, and defect data locally in IndexedDB, then sync automatically when connectivity is restored. This is essential for rural playground sites where mobile coverage is inconsistent.',
  },
  {
    question: 'How much does InspectVoice cost?',
    answer:
      'InspectVoice Team is £99 per month with a 30-day free trial. This includes up to 5 inspectors, unlimited inspections, 50 sites, 50GB storage, and email support. Unlike per-inspection pricing models used by other platforms (typically £3 per inspection), InspectVoice is a flat monthly fee — the more you inspect, the better value it gets. Enterprise pricing for larger organisations and councils is available on request.',
  },
  {
    question: 'How does InspectVoice compare to other playground inspection apps?',
    answer:
      'Most playground inspection apps require manual typing or selecting from predefined lists. None combine voice capture, AI-powered defect extraction with automatic BS EN referencing, previous findings carry-forward, and instant signed PDF output. InspectVoice also includes route planning, a defect library that grows from real field usage, inspector performance tracking, and baseline photo comparison — features that other platforms in the UK playground sector do not offer.',
  },
  {
    question: 'What types of playground inspection does InspectVoice support?',
    answer:
      'InspectVoice supports all three inspection types defined in BS EN 1176-7: routine visual inspections (daily to weekly checks for obvious hazards), operational inspections (monthly to quarterly detailed equipment checks), and annual inspections (comprehensive assessments by qualified inspectors). Each type has its own configurable checklist and inspection template.',
  },
];

// =============================================
// JSON-LD SCHEMA GRAPH
// =============================================

const JSON_LD_GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    // 1. BreadcrumbList
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: SITE_URL,
        },
      ],
    },
    // 2. SoftwareApplication
    {
      '@type': 'SoftwareApplication',
      name: 'InspectVoice',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description: PAGE_DESCRIPTION,
      url: SITE_URL,
      author: { '@type': 'Organization', name: 'Autaimate' },
      offers: {
        '@type': 'Offer',
        price: '99',
        priceCurrency: 'GBP',
        description: 'Team plan from £99/month. 30-day free trial. Enterprise pricing on request.',
      },
      featureList: [
        'Voice-driven inspection capture',
        'BS EN 1176/1177 compliance',
        'AI-powered defect extraction',
        'Previous findings carry-forward',
        'Instant signed PDF reports',
        'Route planning with optimised stop order',
        'Inspector performance tracking',
        'Defect library with field-driven growth',
        'Baseline photo comparison',
        'Manufacturer recall tracking',
        'Multi-site asset register',
        'Offline-first with cached authentication',
        'Real-time priority hotlist',
        'Sealed exports with cryptographic verification',
      ],
    },
    // 3. FAQPage
    {
      '@type': 'FAQPage',
      mainEntity: FAQ_DATA.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
    // 4. HowTo
    {
      '@type': 'HowTo',
      name: 'How to Conduct a Playground Inspection with InspectVoice',
      description:
        'Step-by-step guide to completing a BS EN 1176 compliant playground inspection using voice-driven AI technology.',
      step: [
        {
          '@type': 'HowToStep',
          name: 'Plan Your Route',
          text: "Open the route planner to see today's sites ordered by due date. Tap optimise for the most efficient driving route with turn-by-turn directions.",
        },
        {
          '@type': 'HowToStep',
          name: 'Start Inspection',
          text: 'Select your site, choose the inspection type (routine, operational, or annual), and begin. Previous findings for each asset load automatically.',
        },
        {
          '@type': 'HowToStep',
          name: 'Voice Capture',
          text: 'Walk the site speaking observations aloud. InspectVoice transcribes, extracts defects with BS EN references, and assigns risk ratings automatically.',
        },
        {
          '@type': 'HowToStep',
          name: 'Review Previous Findings',
          text: 'Mark carried-forward defects as Resolved, Still Present, or Worsened. Unresolved defects carry into the new report with recurring flags.',
        },
        {
          '@type': 'HowToStep',
          name: 'Sign and Generate PDF',
          text: 'Review the AI-generated report, make any adjustments, digitally sign, and download the professional PDF — all before leaving site.',
        },
      ],
    },
    // 5. Organization
    {
      '@type': 'Organization',
      name: 'Autaimate',
      url: 'https://autaimate.com',
      logo: `${SITE_URL}/autaimate-logo.png`,
      description:
        'UK-based software company building voice-driven AI tools for regulated industries including playground safety, electrical certification, and equipment compliance.',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: 'support@autaimate.com',
      },
    },
    // 6. WebPage with Speakable
    {
      '@type': 'WebPage',
      name: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      url: SITE_URL,
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['#quick-answer', '#hero-heading'],
      },
    },
    // 7. Article (educational content)
    {
      '@type': 'Article',
      headline: 'The Complete Guide to UK Playground Inspection Compliance',
      author: { '@type': 'Organization', name: 'Autaimate' },
      publisher: { '@type': 'Organization', name: 'Autaimate' },
      datePublished: '2026-01-15',
      dateModified: '2026-04-22',
      description:
        'Comprehensive guide covering BS EN 1176, BS EN 1177, routine visual inspections, operational inspections, and annual inspections for UK local authority playgrounds.',
    },
    // 8. DefinedTermSet
    {
      '@type': 'DefinedTermSet',
      name: 'Playground Safety Inspection Terminology',
      definedTerm: [
        {
          '@type': 'DefinedTerm',
          name: 'Routine Visual Inspection',
          description:
            'A basic check carried out at regular intervals (typically daily to weekly) to identify obvious hazards such as vandalism, broken equipment, or contamination. Required under BS EN 1176-7.',
        },
        {
          '@type': 'DefinedTerm',
          name: 'Operational Inspection',
          description:
            'A more detailed check of equipment function, stability, and wear. Typically carried out every 1–3 months by a trained operative. Covers structural integrity, moving parts, and surface condition.',
        },
        {
          '@type': 'DefinedTerm',
          name: 'Annual Inspection',
          description:
            'A comprehensive assessment by a qualified RPII-registered inspector covering all aspects of equipment safety, surface impact attenuation, foundations, and compliance with BS EN 1176 and BS EN 1177.',
        },
        {
          '@type': 'DefinedTerm',
          name: 'BS EN 1176',
          description:
            'The European standard for playground equipment safety, covering design, installation, inspection, and maintenance. Parts 1–11 address specific equipment types.',
        },
        {
          '@type': 'DefinedTerm',
          name: 'BS EN 1177',
          description:
            'The European standard for impact-absorbing playground surfacing, specifying critical fall height requirements and testing methods for surface materials.',
        },
      ],
    },
  ],
};

// =============================================
// FEATURE DATA
// =============================================

const FEATURES = [
  {
    icon: Mic,
    title: 'Voice-First Capture',
    description:
      'Speak your observations naturally while walking the site. AI transcribes, extracts structured defects, and maps to BS EN 1176 references automatically.',
  },
  {
    icon: Shield,
    title: 'BS EN 1176/1177 Compliant',
    description:
      'Pre-populated inspection checklists with full standard clause references. Severity classifications align with industry practice across all three inspection tiers.',
  },
  {
    icon: History,
    title: 'Previous Findings Carry-Forward',
    description:
      'Open defects from previous inspections appear automatically per asset. Mark as Resolved, Still Present, or Worsened. Recurring defects are flagged with visit count — critical evidence for councils.',
  },
  {
    icon: Printer,
    title: 'Instant Signed PDF Reports',
    description:
      'Professional PDF with table of contents, numbered sections, inspection methodology, risk severity key, and each asset on its own page. Ready before you leave site.',
  },
  {
    icon: Navigation,
    title: 'Route Planning',
    description:
      "See today's due and overdue sites on a map. Optimise your driving route with one tap and get turn-by-turn directions between sites.",
  },
  {
    icon: Camera,
    title: 'Baseline Photo Comparison',
    description:
      'Compare current photos against the baseline for each asset. Visual evidence of deterioration over time, with condition ratings tracked across inspections.',
  },
  {
    icon: BookOpen,
    title: 'Defect Library',
    description:
      'Common defects with BS EN references, risk ratings, and remedial actions. Grows organically from real field usage — custom defects auto-save for next time.',
  },
  {
    icon: BarChart3,
    title: 'Inspector Performance',
    description:
      'Track inspection throughput, defect detection rates, and completion times. Identify training needs and recognise top performers across your team.',
  },
  {
    icon: AlertTriangle,
    title: 'Priority Hotlist',
    description:
      'Very high and high severity defects surface instantly on the manager dashboard with days open, site location, and recurring flag. Never lose track of critical safety issues.',
  },
  {
    icon: Smartphone,
    title: 'Works Fully Offline',
    description:
      'Opens from cache with no signal. Cached authentication means inspectors can start working immediately. All data syncs automatically when connectivity returns.',
  },
  {
    icon: Sun,
    title: 'Outdoor-Readable Design',
    description:
      'Light theme optimised for bright sunlight on site. Dark theme for office use. One-tap toggle persists your preference across sessions.',
  },
  {
    icon: Users,
    title: 'Team Roles & Client Portal',
    description:
      'Role-based access for inspectors, managers, and administrators. Client portal with magic links gives councils read-only access to their inspection data.',
  },
  {
    icon: FileText,
    title: 'Sealed Auditable Records',
    description:
      'Every inspection, defect, and action is timestamped and attributed. Sealed exports with cryptographic verification ensure reports cannot be tampered with.',
  },
  {
    icon: Lock,
    title: 'Enterprise Security',
    description:
      'Multi-factor authentication, encrypted database connections, OWASP-compliant architecture, and GDPR-ready data handling with DPIA documentation.',
  },
  {
    icon: MapPin,
    title: 'Multi-Site Management',
    description:
      'Unlimited sites with individual asset registers, inspection schedules, and defect histories. Aggregate reporting and cross-site compliance tracking.',
  },
];

const STATS = [
  { value: '60%', label: 'Less time per inspection' },
  { value: '100%', label: 'BS EN 1176 coverage' },
  { value: '£99', label: 'Per month, unlimited inspections' },
  { value: '0', label: 'Paper forms needed' },
];

// =============================================
// COMPONENTS
// =============================================

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-5 text-left gap-4 group"
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="pb-5 pr-8">
          <p className="text-slate-600 leading-relaxed text-[15px]">{answer}</p>
        </div>
      )}
    </div>
  );
}

// =============================================
// MAIN PAGE COMPONENT
// =============================================

export default function LandingPage() {
  return (
    <>
      {/* =============================================
          SEO: HEAD — ALL 15 POINTS, SSG-INJECTED
          ============================================= */}
      <Head>
        <title>{PAGE_TITLE}</title>
        <meta name="description" content={PAGE_DESCRIPTION} />
        <link rel="canonical" href={SITE_URL} />
        <meta
          name="robots"
          content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={PAGE_DESCRIPTION} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:site_name" content="InspectVoice" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={PAGE_TITLE} />
        <meta name="twitter:description" content={PAGE_DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />
        <meta name="author" content="Autaimate" />
        <meta name="publisher" content="Autaimate" />
        <meta name="theme-color" content="#16a34a" />
        <script type="application/ld+json">{JSON.stringify(JSON_LD_GRAPH)}</script>
      </Head>

      <div className="min-h-screen bg-white">
        {/* =============================================
            NAVIGATION BAR
            ============================================= */}
        <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Mic className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">InspectVoice</span>
            </div>
            <div className="hidden sm:flex items-center gap-8 text-sm text-slate-600">
              <a href="#features" className="hover:text-emerald-700 transition-colors">
                Features
              </a>
              <a href="#how-it-works" className="hover:text-emerald-700 transition-colors">
                How It Works
              </a>
              <a href="#pricing" className="hover:text-emerald-700 transition-colors">
                Pricing
              </a>
              <a href="#compliance" className="hover:text-emerald-700 transition-colors">
                Compliance
              </a>
              <a href="#faq" className="hover:text-emerald-700 transition-colors">
                FAQ
              </a>
            </div>
            <Link
              to="/sign-in"
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              Sign In
            </Link>
          </div>
        </nav>

        {/* =============================================
            HERO SECTION
            ============================================= */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgb(0,0,0) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          />

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
            <div
              id="quick-answer"
              className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 mb-8"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700 tracking-wide uppercase">
                Voice-powered playground inspections — signed PDF before you leave site
              </span>
            </div>

            <div className="max-w-3xl">
              <h1
                id="hero-heading"
                className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold text-slate-900 leading-[1.1] tracking-tight"
              >
                Inspect. Speak. Done.{' '}
                <span className="text-emerald-600">Report ready at the van.</span>
              </h1>

              <p className="mt-6 text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl">
                InspectVoice turns a 2-hour inspection-plus-report into a 30-minute site visit
                with a professional signed PDF. Speak your findings, AI extracts the defects with
                BS EN 1176 references, previous issues carry forward automatically. No office
                write-up. No second pass.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  to="/sign-up"
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-7 py-3.5 rounded-lg transition-colors text-base"
                >
                  Start Free Trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-7 py-3.5 rounded-lg border border-slate-200 transition-colors text-base"
                >
                  See How It Works
                </a>
              </div>
            </div>

            {/* Stats bar */}
            <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 max-w-2xl">
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{stat.value}</p>
                  <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =============================================
            COMPETITOR COMPARISON
            ============================================= */}
        <section className="py-16 sm:py-20 bg-emerald-600">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
              Other platforms charge per inspection. We don't.
            </h2>
            <p className="text-emerald-100 text-lg max-w-2xl mx-auto mb-10">
              Per-inspection pricing penalises thoroughness. The more you inspect, the more you pay.
              InspectVoice is a flat monthly fee — inspect as often as you need.
            </p>
            <div className="grid sm:grid-cols-2 gap-6 max-w-xl mx-auto">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
                <p className="text-sm text-emerald-200 uppercase tracking-wider mb-2">Per-inspection pricing</p>
                <p className="text-3xl font-extrabold text-white mb-1">£150+</p>
                <p className="text-emerald-200 text-sm">50 inspections/month at £3 each</p>
                <p className="text-emerald-200 text-xs mt-2">Cost rises with volume</p>
              </div>
              <div className="bg-white rounded-xl p-6 border-2 border-emerald-300 shadow-lg">
                <p className="text-sm text-emerald-600 uppercase tracking-wider font-semibold mb-2">InspectVoice Team</p>
                <p className="text-3xl font-extrabold text-slate-900 mb-1">£99<span className="text-lg font-normal text-slate-500">/month</span></p>
                <p className="text-slate-600 text-sm">Unlimited inspections</p>
                <p className="text-emerald-600 text-xs font-semibold mt-2">The more you inspect, the more you save</p>
              </div>
            </div>
          </div>
        </section>

        {/* =============================================
            FEATURES GRID
            ============================================= */}
        <section id="features" className="py-20 sm:py-24 bg-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Built for playground safety professionals
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Every feature designed around how inspectors actually work in the field — not how
                software developers think they should.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="bg-white rounded-xl p-6 border border-slate-100 hover:border-emerald-200 hover:shadow-md transition-all duration-200"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-4">
                    <feature.icon className="w-5 h-5 text-emerald-600" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =============================================
            HOW IT WORKS
            ============================================= */}
        <section id="how-it-works" className="py-20 sm:py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                From site walk to signed report in minutes
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Five steps replace your entire paper-based inspection workflow.
              </p>
            </div>

            <div className="grid sm:grid-cols-5 gap-4">
              {[
                {
                  step: '1',
                  title: 'Plan Route',
                  desc: "See today's due sites on the map. Tap optimise for the fastest driving route.",
                },
                {
                  step: '2',
                  title: 'Voice Capture',
                  desc: 'Walk the site speaking observations. AI transcribes and extracts defects in real time.',
                },
                {
                  step: '3',
                  title: 'Review Findings',
                  desc: 'Previous defects appear automatically. Mark as Resolved, Still Present, or Worsened.',
                },
                {
                  step: '4',
                  title: 'Sign & PDF',
                  desc: 'Review the report, digitally sign, and download the professional PDF on site.',
                },
                {
                  step: '5',
                  title: 'Drive Away',
                  desc: 'Report is done. No office write-up. Defects are already on the manager dashboard.',
                },
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-600 text-white text-lg font-bold flex items-center justify-center mx-auto mb-4">
                    {item.step}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mb-2">{item.title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =============================================
            PRICING SECTION
            ============================================= */}
        <section id="pricing" className="py-20 sm:py-24 bg-slate-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Simple, predictable pricing
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                No per-inspection fees. No hidden charges. One flat monthly price.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
              {/* Team */}
              <div className="bg-white rounded-2xl border-2 border-emerald-500 shadow-lg p-8 relative">
                <div className="absolute -top-3 left-6 bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                  Most Popular
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-1">Team</h3>
                <p className="text-sm text-slate-500 mb-6">For inspection companies</p>
                <div className="mb-6">
                  <span className="text-4xl font-extrabold text-slate-900">£99</span>
                  <span className="text-slate-500">/month</span>
                </div>
                <ul className="space-y-3 text-sm text-slate-600 mb-8">
                  {[
                    'Up to 5 inspectors',
                    'Unlimited inspections',
                    'Up to 50 sites',
                    '50GB storage',
                    'Voice capture + AI defect extraction',
                    'Previous findings carry-forward',
                    'Instant signed PDF reports',
                    'Route planner with optimisation',
                    'Defect library',
                    'Inspector performance tracking',
                    'Baseline photo comparison',
                    'Offline-first with cached auth',
                    'Email support',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/sign-up"
                  className="block text-center bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  Start 30-Day Free Trial
                </Link>
                <p className="text-xs text-slate-400 text-center mt-3">No credit card required</p>
              </div>

              {/* Enterprise */}
              <div className="bg-white rounded-2xl border border-slate-200 p-8">
                <h3 className="text-xl font-bold text-slate-900 mb-1">Enterprise</h3>
                <p className="text-sm text-slate-500 mb-6">For councils &amp; large organisations</p>
                <div className="mb-6">
                  <span className="text-4xl font-extrabold text-slate-900">Custom</span>
                </div>
                <ul className="space-y-3 text-sm text-slate-600 mb-8">
                  {[
                    'Everything in Team',
                    'Unlimited inspectors',
                    'Unlimited sites',
                    'Dedicated onboarding',
                    'API access',
                    'Custom report templates',
                    'Client portal with magic links',
                    'Sealed exports with verification',
                    'Phone & WhatsApp support',
                    '24/7 P1 incident response',
                    'DPIA & DPA documentation',
                    'Cyber Essentials mapped controls',
                    'Named account manager',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <a
                  href="#contact"
                  className="block text-center bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  Contact Us
                </a>
                <p className="text-xs text-slate-400 text-center mt-3">Tailored to your authority</p>
              </div>
            </div>
          </div>
        </section>

        {/* =============================================
            COMPLIANCE SECTION (Educational Content — contributes to 2,500+ words)
            ============================================= */}
        <section id="compliance" className="py-20 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-12 text-center">
              The Complete Guide to UK Playground Inspection Compliance
            </h2>

            <div className="space-y-6 text-slate-600 text-base leading-relaxed [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-slate-900 [&_h3]:mt-10 [&_h3]:mb-4 [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:text-slate-800 [&_h4]:mt-8 [&_h4]:mb-3 [&_p]:mb-4">
              <h3>Why Playground Inspections Matter</h3>
              <p>
                Local authorities in the United Kingdom have a legal duty of care to ensure that
                playground equipment on their land is safe for public use. This obligation arises
                from the Health and Safety at Work etc. Act 1974, the Occupiers' Liability Acts of
                1957 and 1984, and the Management of Health and Safety at Work Regulations 1999.
                Failure to maintain adequate inspection regimes exposes councils to negligence
                claims, reputational damage, and — most importantly — the risk of serious injury
                to children.
              </p>
              <p>
                The practical framework for meeting these obligations is set out in BS EN 1176
                (Playground Equipment) and BS EN 1177 (Impact-Absorbing Playground Surfacing).
                These European standards, adopted in the UK, define the design, installation,
                inspection, and maintenance requirements for all publicly accessible playground
                equipment.
              </p>

              <h3>Understanding BS EN 1176</h3>
              <p>
                BS EN 1176 is a multi-part standard covering different categories of playground
                equipment. Part 1 sets out general safety requirements applicable to all equipment,
                while subsequent parts address specific types: swings (Part 2), slides (Part 3),
                cableways (Part 4), carousels (Part 5), rocking equipment (Part 6), and so on
                through to Part 11 covering spatial networks. Part 7 is particularly important for
                inspection purposes as it provides guidance on the installation, inspection,
                maintenance, and operation of playground equipment.
              </p>
              <p>
                Under BS EN 1176-7, three levels of inspection are defined, each with a different
                scope, frequency, and competency requirement. Understanding these three tiers is
                essential for any organisation responsible for playground equipment.
              </p>

              <h3>The Three Tiers of Playground Inspection</h3>

              <h4>Tier 1: Routine Visual Inspection</h4>
              <p>
                Routine visual inspections are the most frequent checks, typically carried out
                daily to weekly depending on the level of use and vandalism risk at the site. The
                purpose is to identify obvious hazards that may have arisen since the last
                inspection — broken glass, animal fouling, damaged equipment, missing components,
                or evidence of vandalism. These inspections do not require specialist equipment
                knowledge but do require a systematic approach and a clear recording method.
              </p>
              <p>
                Historically, routine visual inspections have been recorded on paper forms carried
                by grounds maintenance staff or park wardens. The inspector walks the site, notes
                any issues on a clipboard, and the form is filed back at the depot. This approach
                creates several problems: forms can be lost, handwriting can be illegible, there is
                a delay between observation and data entry, and there is no real-time visibility
                for managers. InspectVoice addresses all of these issues by enabling voice-driven
                capture at the point of inspection, with instant digital recording and automatic
                escalation of high-severity findings.
              </p>

              <h4>Tier 2: Operational Inspection</h4>
              <p>
                Operational inspections are more detailed assessments carried out every one to
                three months by a person with some knowledge of playground equipment. The focus is
                on equipment function, structural stability, wear patterns, and the condition of
                surfacing. Inspectors check for loose fixings, excessive wear on moving parts,
                corrosion, rot in timber elements, and degradation of impact-absorbing surfaces.
              </p>
              <p>
                Operational inspections require more structured recording than routine visuals.
                Each piece of equipment should be individually assessed, with findings categorised
                by severity. InspectVoice supports this by maintaining a full asset register where
                every piece of equipment is catalogued with its manufacturer, model, installation
                date, and inspection history. Voice observations are automatically linked to the
                relevant asset, and previous findings from earlier inspections appear automatically
                so the inspector can verify whether issues have been resolved.
              </p>

              <h4>Tier 3: Annual Main Inspection</h4>
              <p>
                The annual main inspection is the most comprehensive assessment, covering all
                aspects of equipment safety, structural integrity, foundation condition, surface
                impact attenuation, and overall compliance with BS EN 1176 and BS EN 1177. These
                inspections must be carried out by a competent person — typically someone registered
                with the Register of Play Inspectors International (RPII) or holding an equivalent
                qualification.
              </p>
              <p>
                Annual inspections often identify issues that are not visible during routine or
                operational checks: subsurface rot, foundation movement, cumulative wear that has
                reached replacement thresholds, or non-compliance with current standards resulting
                from equipment modifications. The findings from annual inspections often drive
                capital expenditure decisions and long-term asset replacement planning.
              </p>

              <h3>The Problem with Per-Inspection Pricing</h3>
              <p>
                Many inspection platforms charge per inspection — typically around £3 per completed
                inspection. This pricing model creates a perverse incentive: the more thoroughly
                you inspect, the more you pay. A company conducting routine visuals three times a
                week across 20 sites faces inspection software costs of over £900 per month. This
                discourages the very thoroughness that safety standards require.
              </p>
              <p>
                InspectVoice uses flat monthly pricing specifically to avoid this problem. At £99
                per month for up to 5 inspectors with unlimited inspections, the cost is
                predictable regardless of inspection volume. This encourages frequent inspection
                and removes the financial barrier to maintaining a robust safety regime.
              </p>

              <h3>The Cost of Paper-Based Inspection Systems</h3>
              <p>
                Many UK councils still rely on paper forms, spreadsheets, or generic asset
                management systems that were not designed for playground inspection. These
                approaches create measurable costs and risks.
              </p>
              <p>
                First, there is the time cost. An inspector completing a routine visual inspection
                on paper typically spends 15–20 minutes at the site, then another 10–15 minutes
                back at the depot entering the data into a spreadsheet or database. With voice
                capture and instant PDF generation, the data entry step is eliminated entirely —
                the report is complete before the inspector leaves site. For a company managing
                50–100 playground sites, this represents a saving of hundreds of hours per year.
              </p>
              <p>
                Second, there is the compliance risk. Paper records can be lost, damaged, or
                incomplete. In the event of an accident and subsequent legal claim, the organisation
                must demonstrate that a reasonable inspection regime was in place and properly
                documented. Missing or illegible records undermine this defence. Digital records
                with timestamps, user attribution, and immutable audit trails provide a
                significantly stronger evidential position.
              </p>
              <p>
                Third, there is the visibility gap. With paper-based systems, a high-severity
                defect observed on Monday morning might not reach the parks manager until the
                forms are processed on Wednesday. In that window, a child could be injured. Digital
                systems with real-time escalation close this gap — a very high severity defect
                appears on the manager dashboard within seconds of being recorded.
              </p>

              <h3>Why Previous Findings Matter</h3>
              <p>
                One of the most critical elements of a defensible inspection regime is demonstrating
                that reported defects are tracked to resolution. If an inspector reports a chain
                link wear issue on visit 1, and the same defect is still present on visit 2, and
                again on visit 3 — that documented trail becomes powerful evidence of whether the
                responsible organisation acted on the findings.
              </p>
              <p>
                InspectVoice automatically surfaces open defects from previous inspections when an
                inspector revisits an asset. Each finding appears with the full original detail,
                and the inspector marks it as Resolved, Still Present, or Worsened. Recurring
                defects carry into the new report with a flag showing how many consecutive
                inspections the issue has been open. This creates exactly the audit trail that
                solicitors and insurers look for when assessing liability.
              </p>

              <h3>Impact-Absorbing Surfaces and BS EN 1177</h3>
              <p>
                BS EN 1177 specifies the requirements for impact-absorbing playground surfacing.
                The standard defines the critical fall height (CFH) for each piece of equipment and
                requires that the surfacing beneath it provides adequate impact attenuation at that
                height. Common surfacing materials include wet-pour rubber, rubber tiles, bark
                mulch, and synthetic grass with shock pads.
              </p>
              <p>
                Surface condition is a critical element of both operational and annual inspections.
                Degradation, displacement, contamination, and compaction can all reduce the
                impact-absorbing performance of surfacing materials. InspectVoice enables inspectors
                to record surface condition observations as part of the standard inspection flow,
                with severity classifications that trigger maintenance actions when thresholds are
                exceeded. Baseline photo comparison shows visual deterioration over time.
              </p>

              <h3>Building a Defensible Inspection Regime</h3>
              <p>
                A defensible inspection regime requires three elements: competent inspectors,
                adequate frequency, and complete records. InspectVoice supports all three. The
                platform ensures inspections are completed to a consistent standard regardless
                of which inspector conducts them, the route planner with due-date tracking
                prevents inspections from being missed, and every finding is recorded with full
                metadata including timestamp, user, location, severity, BS EN reference, and
                photographic evidence.
              </p>
              <p>
                For organisations facing increasing pressure on budgets and resources, InspectVoice
                provides a way to maintain — and demonstrably improve — inspection standards
                while reducing the time and cost of the inspection process. The combination of
                voice capture, AI defect extraction, previous findings carry-forward, and instant
                PDF generation means that inspectors spend more time looking at equipment and
                less time writing about it.
              </p>
            </div>
          </div>
        </section>

        {/* =============================================
            SOCIAL PROOF / TRUST
            ============================================= */}
        <section className="py-16 sm:py-20 bg-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-emerald-600 rounded-2xl p-8 sm:p-12 text-center">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                Built by people who understand regulated industries
              </h2>
              <p className="text-emerald-100 max-w-2xl mx-auto text-base leading-relaxed mb-8">
                InspectVoice is developed by Autaimate, a UK company with over 40 years of
                construction and compliance industry experience. We build practical software for
                the industries that larger companies ignore.
              </p>
              <div className="flex flex-wrap justify-center gap-6 text-sm text-emerald-200">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  UK-based development
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  GDPR compliant
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  BS EN 1176 framework
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Enterprise security
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Offline-first architecture
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =============================================
            FAQ SECTION
            ============================================= */}
        <section id="faq" className="py-20 sm:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight text-center mb-12">
              Frequently Asked Questions
            </h2>

            <div className="bg-white rounded-xl border border-slate-200 divide-y-0 px-6">
              {FAQ_DATA.map((faq) => (
                <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
              ))}
            </div>
          </div>
        </section>

        {/* =============================================
            CTA SECTION (id="get-started")
            ============================================= */}
        <section id="get-started" className="py-20 sm:py-24 bg-slate-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Ready to modernise your playground inspections?
              </h2>
              <p className="mt-4 text-lg text-slate-600 max-w-xl mx-auto">
                Start your 30-day free trial today, or get in touch for an Enterprise demo
                tailored to your organisation.
              </p>
            </div>

            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/sign-up"
                className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-base"
              >
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#contact"
                className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-8 py-4 rounded-lg border border-slate-200 transition-colors text-base"
              >
                Contact for Enterprise
              </a>
            </div>

            <p className="mt-6 text-sm text-slate-400 text-center">
              No credit card required for free trial. Enterprise includes dedicated onboarding.
            </p>
          </div>
        </section>

        {/* =============================================
            CONTACT FORM (id="contact")
            ============================================= */}
        <section id="contact" className="py-20 sm:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Get in touch
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Enterprise enquiry, demo request, or just a question — we'll get back to you within 24 hours.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <iframe
                src="https://app.smartsuite.com/form/sba974gi/tqV2bj6kTj?header=false"
                width="100%"
                height="600"
                frameBorder="0"
                title="Contact InspectVoice"
                loading="lazy"
                className="block"
              />
            </div>
          </div>
        </section>

        {/* =============================================
            FOOTER
            ============================================= */}
        <footer className="bg-slate-900 text-slate-400 py-12">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid sm:grid-cols-4 gap-8 mb-8">
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center">
                    <Mic className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-sm font-bold text-white">InspectVoice</span>
                </div>
                <p className="text-xs leading-relaxed">
                  Voice-driven AI playground inspection software for UK inspection companies and local authorities.
                  BS EN 1176/1177 compliant. From £99/month.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">
                  Product
                </h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <a href="#features" className="hover:text-emerald-400 transition-colors">
                      Features
                    </a>
                  </li>
                  <li>
                    <a href="#how-it-works" className="hover:text-emerald-400 transition-colors">
                      How It Works
                    </a>
                  </li>
                  <li>
                    <a href="#pricing" className="hover:text-emerald-400 transition-colors">
                      Pricing
                    </a>
                  </li>
                  <li>
                    <a href="#compliance" className="hover:text-emerald-400 transition-colors">
                      Compliance Guide
                    </a>
                  </li>
                  <li>
                    <a href="#faq" className="hover:text-emerald-400 transition-colors">
                      FAQ
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">
                  Company
                </h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <a
                      href="https://autaimate.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-emerald-400 transition-colors"
                    >
                      Autaimate
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:support@autaimate.com"
                      className="hover:text-emerald-400 transition-colors"
                    >
                      support@autaimate.com
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">
                  Legal
                </h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link to="/privacy" className="hover:text-emerald-400 transition-colors">
                      Privacy Policy
                    </Link>
                  </li>
                  <li>
                    <Link to="/terms" className="hover:text-emerald-400 transition-colors">
                      Terms of Service
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-6 text-xs text-center">
              <p>
                &copy; {new Date().getFullYear()} InspectVoice — Built by{' '}
                <a
                  href="https://autaimate.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Autaimate
                </a>
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

