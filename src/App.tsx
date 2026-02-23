import { Routes, Route } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Shield, Mic, ClipboardCheck, TreePine } from 'lucide-react';

/**
 * InspectVoice — Voice-Driven AI Inspection Platform
 * BS EN 1176/1177 compliant for UK parks, playgrounds and outdoor recreation
 *
 * Route structure (will expand as pages are built):
 * /                    → Dashboard / home
 * /sites               → Site registry
 * /sites/:id           → Site detail
 * /inspect/:id         → Active inspection capture
 * /review/:id          → Inspection review (AI results)
 * /reports/:id         → Report view / export
 * /defects             → Defect tracking dashboard
 * /settings            → User/org settings
 */

function DashboardPlaceholder(): JSX.Element {
  return (
    <div className="min-h-dvh bg-iv-bg flex flex-col">
      <Helmet>
        <title>InspectVoice — Voice-Driven Inspection Platform</title>
        <meta
          name="description"
          content="Voice-driven AI inspection platform for UK parks, playgrounds and outdoor recreation assets. BS EN 1176 compliant."
        />
      </Helmet>

      {/* Header */}
      <header className="border-b border-iv-border bg-iv-surface/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-iv-accent/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-iv-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-iv-text leading-tight">
                InspectVoice
              </h1>
              <p className="text-2xs text-iv-muted">
                BS EN 1176 Inspection Platform
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-iv-text mb-2">
            Welcome to InspectVoice
          </h2>
          <p className="text-iv-muted">
            Voice-driven, AI-assisted inspection platform for UK parks,
            playgrounds and outdoor recreation assets.
          </p>
        </div>

        {/* Feature cards — will become live navigation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={<Mic className="w-5 h-5" />}
            title="Voice Capture"
            description="Dictate findings, snap photos. AI generates BS EN-compliant reports."
            status="Coming soon"
          />
          <FeatureCard
            icon={<ClipboardCheck className="w-5 h-5" />}
            title="Three Inspection Types"
            description="Routine Visual, Operational, and Annual Main — per BS EN 1176-7."
            status="Coming soon"
          />
          <FeatureCard
            icon={<TreePine className="w-5 h-5" />}
            title="Asset Register"
            description="Mandatory equipment registry per site with reference photos and history."
            status="Coming soon"
          />
        </div>

        {/* Build status */}
        <div className="mt-12 iv-panel p-4">
          <p className="text-sm text-iv-muted">
            <span className="text-iv-accent font-medium">Build Status:</span>{' '}
            Scaffold deployed. Core data types and offline store next.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-iv-border py-4 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <p className="text-xs text-iv-muted-2">
            &copy; {new Date().getFullYear()} Autaimate Ltd. All rights reserved.
          </p>
          <p className="text-xs text-iv-muted-2">v0.1.0</p>
        </div>
      </footer>
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: string;
}

function FeatureCard({ icon, title, description, status }: FeatureCardProps): JSX.Element {
  return (
    <div className="iv-card">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-iv-accent/10 flex items-center justify-center shrink-0 text-iv-accent">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-iv-text mb-1">{title}</h3>
          <p className="text-sm text-iv-muted leading-relaxed">{description}</p>
          <span className="inline-block mt-2 text-2xs text-iv-muted-2 bg-iv-surface-2 px-2 py-0.5 rounded-full">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<DashboardPlaceholder />} />
      {/* Routes added per batch as pages are built */}
    </Routes>
  );
}
