/**
 * InspectVoice — Privacy Policy
 * src/pages/PrivacyPage.tsx
 *
 * Route: /privacy (public)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Mic, ArrowLeft } from 'lucide-react';

const SITE_URL = 'https://inspectvoice.co.uk';
const LAST_UPDATED = '26 February 2026';

export default function PrivacyPage() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy | InspectVoice</title>
        <meta
          name="description"
          content="InspectVoice privacy policy. How we collect, use, and protect your data. GDPR compliant."
        />
        <link rel="canonical" href={`${SITE_URL}/privacy`} />
        <meta name="robots" content="index, follow" />
      </Helmet>

      <div className="min-h-screen bg-white">
        {/* Nav */}
        <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Mic className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">InspectVoice</span>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-emerald-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </div>
        </nav>

        {/* Content */}
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-400 mb-12">Last updated: {LAST_UPDATED}</p>

          <div className="space-y-8 text-slate-600 text-[15px] leading-relaxed [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2">

            <p>
              InspectVoice ("we", "us", "our") is operated by Autaimate. We are committed to
              protecting the privacy of our users. This policy explains how we collect, use,
              store, and protect your personal data when you use the InspectVoice platform.
            </p>

            <h2>1. Who We Are</h2>
            <p>
              Autaimate is a UK-based software company. For the purposes of UK data protection
              legislation (UK GDPR and the Data Protection Act 2018), Autaimate is the data
              controller for personal data processed through the InspectVoice platform.
            </p>
            <p>
              Contact: <a href="mailto:support@autaimate.com" className="text-emerald-600 hover:underline">support@autaimate.com</a>
            </p>

            <h2>2. Data We Collect</h2>

            <h3>Account Data</h3>
            <p>
              When you create an account, we collect your name, email address, and organisation
              details. Authentication is handled by Clerk, a third-party identity provider. We
              do not store passwords.
            </p>

            <h3>Inspection Data</h3>
            <p>
              When you conduct inspections, we collect voice transcriptions, defect descriptions,
              severity classifications, photographs (including geolocation metadata and timestamps),
              inspector identity, and inspection outcomes. This data is necessary for the core
              function of the platform and for maintaining legally defensible inspection records.
            </p>

            <h3>Usage Data</h3>
            <p>
              We collect anonymised usage data including pages visited, features used, and
              performance metrics. This data is used to improve the platform and is processed
              via Google Analytics 4 and Sentry error tracking. No personally identifiable
              information is sent to these services.
            </p>

            <h2>3. How We Use Your Data</h2>
            <p>We use your data to:</p>
            <p>
              Provide the InspectVoice inspection management service, generate inspection reports
              and defect records, send notification emails (summaries, alerts) that you or your
              organisation have configured, maintain audit trails for legal and insurance
              defensibility, improve the platform through anonymised usage analytics, and
              communicate with you about your account or service updates.
            </p>

            <h2>4. Legal Basis for Processing</h2>
            <p>
              We process your personal data on the following legal bases under UK GDPR:
              performance of a contract (providing the service you have signed up for),
              legitimate interests (improving the platform, maintaining security), and
              legal obligation (maintaining records required by health and safety legislation
              where applicable to your organisation's use of the platform).
            </p>

            <h2>5. Data Sharing</h2>
            <p>
              We do not sell your personal data. We share data only with the following categories
              of processor, all of whom are bound by data processing agreements:
            </p>
            <p>
              Clerk (authentication), Neon (database hosting), Resend (email delivery),
              Cloudflare (edge hosting and file storage), Railway (application hosting),
              Sentry (error tracking — anonymised), and Google Analytics (usage analytics —
              anonymised).
            </p>
            <p>
              Inspection data may be shared within your organisation as configured by your
              organisation's administrators — for example, email summaries sent to stakeholders,
              or client portal access granted to external parties.
            </p>

            <h2>6. Data Retention</h2>
            <p>
              Inspection records, defect data, and audit logs are retained for the duration of
              your organisation's subscription and for a minimum of 6 years after account closure,
              in line with UK limitation periods for negligence claims relating to playground
              safety. Account data is deleted within 30 days of account closure upon request.
            </p>

            <h2>7. Data Security</h2>
            <p>
              All data is encrypted in transit (TLS 1.2+) and at rest. Database connections use
              encrypted channels. Authentication includes multi-factor authentication (MFA)
              capability. Access to production systems is restricted to authorised personnel.
              We maintain an audit log of all data access and modifications.
            </p>

            <h2>8. Your Rights</h2>
            <p>
              Under UK GDPR, you have the right to access your personal data, rectify
              inaccurate data, erase your data (subject to legal retention requirements),
              restrict processing, data portability, and object to processing. To exercise
              any of these rights, contact us at{' '}
              <a href="mailto:support@autaimate.com" className="text-emerald-600 hover:underline">support@autaimate.com</a>.
              We will respond within 30 days.
            </p>

            <h2>9. Cookies</h2>
            <p>
              InspectVoice uses essential cookies for authentication and session management.
              We use Google Analytics which sets analytical cookies. You can control cookie
              preferences in your browser settings.
            </p>

            <h2>10. Children's Data</h2>
            <p>
              InspectVoice is a business-to-business platform for playground safety professionals.
              We do not knowingly collect personal data from children. The inspection data captured
              relates to equipment condition, not to individual children using the equipment.
            </p>

            <h2>11. International Transfers</h2>
            <p>
              Some of our service providers process data outside the UK. Where this occurs, we
              ensure appropriate safeguards are in place, including standard contractual clauses
              approved by the ICO, or the service provider being located in a country with an
              adequacy decision.
            </p>

            <h2>12. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. We will notify registered
              users of material changes via email. The "last updated" date at the top of this
              page indicates when the policy was last revised.
            </p>

            <h2>13. Complaints</h2>
            <p>
              If you have concerns about how we handle your data, please contact us at{' '}
              <a href="mailto:support@autaimate.com" className="text-emerald-600 hover:underline">support@autaimate.com</a>.
              You also have the right to lodge a complaint with the Information Commissioner's
              Office (ICO) at{' '}
              <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">ico.org.uk</a>.
            </p>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-slate-900 text-slate-400 py-8">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-xs text-center">
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
        </footer>
      </div>
    </>
  );
}
