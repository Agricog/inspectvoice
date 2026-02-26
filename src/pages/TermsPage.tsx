/**
 * InspectVoice — Terms of Service
 * src/pages/TermsPage.tsx
 *
 * Route: /terms (public)
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Mic, ArrowLeft } from 'lucide-react';

const SITE_URL = 'https://inspectvoice.co.uk';
const LAST_UPDATED = '26 February 2026';

export default function TermsPage() {
  return (
    <>
      <Helmet>
        <title>Terms of Service | InspectVoice</title>
        <meta
          name="description"
          content="InspectVoice terms of service. Terms and conditions for using the InspectVoice playground inspection platform."
        />
        <link rel="canonical" href={`${SITE_URL}/terms`} />
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
            Terms of Service
          </h1>
          <p className="text-sm text-slate-400 mb-12">Last updated: {LAST_UPDATED}</p>

          <div className="space-y-8 text-slate-600 text-[15px] leading-relaxed [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-6 [&_h3]:mb-2">

            <p>
              These Terms of Service ("Terms") govern your use of the InspectVoice platform
              ("Service"), operated by Autaimate ("we", "us", "our"). By accessing or using
              the Service, you agree to be bound by these Terms. If you do not agree, do not
              use the Service.
            </p>

            <h2>1. Service Description</h2>
            <p>
              InspectVoice is a voice-driven AI inspection management platform designed for
              UK playground safety inspections. The Service enables organisations to conduct,
              record, manage, and report on playground equipment inspections in accordance with
              BS EN 1176 and BS EN 1177 standards.
            </p>

            <h2>2. Eligibility</h2>
            <p>
              The Service is available to organisations and individuals responsible for
              playground equipment inspection and maintenance. You must be at least 18 years
              old and have the authority to bind your organisation to these Terms. By creating
              an account, you represent that you meet these requirements.
            </p>

            <h2>3. Accounts and Access</h2>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials
              and for all activity that occurs under your account. You must notify us immediately
              if you become aware of any unauthorised use of your account. We reserve the right
              to suspend or terminate accounts that violate these Terms.
            </p>
            <p>
              Organisation administrators are responsible for managing user access, roles, and
              permissions within their organisation. We are not liable for actions taken by
              users within your organisation's account.
            </p>

            <h2>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <p>
              Use the Service for any unlawful purpose, attempt to gain unauthorised access to
              any part of the Service or its infrastructure, interfere with or disrupt the
              Service, upload malicious code or content, use the Service to store or transmit
              content that infringes third-party intellectual property rights, or reverse
              engineer, decompile, or disassemble any part of the Service.
            </p>

            <h2>5. Data Ownership</h2>
            <p>
              You retain ownership of all inspection data, defect records, photographs, and
              other content you create using the Service ("Your Data"). By using the Service,
              you grant us a limited licence to process, store, and transmit Your Data solely
              for the purpose of providing the Service to you.
            </p>
            <p>
              We do not claim ownership of Your Data and will not use it for any purpose other
              than providing and improving the Service, except as required by law.
            </p>

            <h2>6. Data Processing</h2>
            <p>
              Our processing of personal data is governed by our{' '}
              <Link to="/privacy" className="text-emerald-600 hover:underline">Privacy Policy</Link>.
              Where we process personal data on your behalf as a data processor, we will enter
              into a Data Processing Agreement upon request.
            </p>

            <h2>7. Service Availability</h2>
            <p>
              We aim to maintain the Service at high availability but do not guarantee
              uninterrupted access. The Service may be temporarily unavailable for maintenance,
              updates, or due to circumstances beyond our control. We will endeavour to provide
              advance notice of planned maintenance where practicable.
            </p>
            <p>
              The Service includes offline capability for inspection capture. Data captured
              offline will synchronise when connectivity is restored. We are not liable for
              data loss resulting from device failure prior to synchronisation.
            </p>

            <h2>8. Subscription and Payment</h2>
            <p>
              Access to InspectVoice is subject to a subscription agreement. Pricing is based
              on the number of sites under management and is agreed on a per-organisation basis.
              Payment terms are set out in your subscription agreement. We reserve the right to
              modify pricing with 30 days' written notice.
            </p>

            <h2>9. Intellectual Property</h2>
            <p>
              The Service, including its design, features, code, documentation, and branding,
              is the intellectual property of Autaimate and is protected by UK and international
              copyright, trademark, and other intellectual property laws. These Terms do not
              grant you any rights to our intellectual property except the limited right to use
              the Service as described herein.
            </p>

            <h2>10. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" and "as available". While we strive to ensure
              accuracy, we do not warrant that the Service will meet your specific compliance
              requirements, that AI-generated transcriptions or classifications will be error-free,
              or that the Service will identify all defects or safety issues.
            </p>
            <p>
              InspectVoice is a tool to assist trained inspectors. It does not replace the need
              for competent inspection personnel, professional judgment, or compliance with
              applicable health and safety legislation. You are responsible for verifying the
              accuracy of all inspection data and reports generated by the Service.
            </p>

            <h2>11. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Autaimate shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, or any loss
              of profits, revenue, data, or business opportunities arising from your use of
              the Service.
            </p>
            <p>
              Our total aggregate liability for any claims arising from or related to the
              Service shall not exceed the total fees paid by you in the 12 months preceding
              the claim. Nothing in these Terms excludes or limits liability for death or
              personal injury caused by negligence, fraud, or any other liability that cannot
              be excluded under English law.
            </p>

            <h2>12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Autaimate from any claims, damages,
              losses, or expenses (including reasonable legal fees) arising from your use of
              the Service, your violation of these Terms, or your violation of any third-party
              rights.
            </p>

            <h2>13. Termination</h2>
            <p>
              Either party may terminate the subscription by providing 30 days' written notice.
              Upon termination, your access to the Service will cease. We will retain Your Data
              in accordance with our Privacy Policy and applicable legal retention requirements.
              You may request an export of Your Data prior to termination.
            </p>

            <h2>14. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify registered users of
              material changes via email at least 14 days before they take effect. Continued
              use of the Service after changes become effective constitutes acceptance of the
              revised Terms.
            </p>

            <h2>15. Governing Law</h2>
            <p>
              These Terms are governed by and construed in accordance with the laws of England
              and Wales. Any disputes arising from these Terms or the Service shall be subject
              to the exclusive jurisdiction of the courts of England and Wales.
            </p>

            <h2>16. Contact</h2>
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:support@autaimate.com" className="text-emerald-600 hover:underline">
                support@autaimate.com
              </a>.
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
