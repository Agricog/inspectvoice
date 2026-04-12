/**
 * InspectVoice — PageHelp Component
 * Floating help button + full-screen overlay with accordion sections.
 * Matches CertVoice help pattern.
 *
 * Usage:
 *   import { PageHelp } from '@components/PageHelp';
 *
 *   // Place once at the bottom of your page component:
 *   <PageHelp pageKey="sites" />
 *
 * Features:
 *   - Floating ? button fixed bottom-right (above mobile nav)
 *   - Full-screen overlay with page title, summary, accordion sections
 *   - Numbered steps within each section
 *   - Sections expand/collapse on tap
 *   - Closes on X button or Escape key
 *   - Always dark theme (hardcoded — overlay is always dark regardless of app theme)
 *   - Mobile-first, works on all screen sizes
 *   - Accessible: focus management, aria labels, keyboard navigation
 *
 * FIX: Apr 2026
 *   - Replaced all iv-text / iv-muted / iv-muted-2 / iv-text CSS variable classes
 *     inside the overlay with hardcoded dark-theme colours. The overlay background
 *     is always #0C0F14 (dark), but iv-* variables follow the app's current theme.
 *     In light mode (the default for outdoor use) iv-text resolves to a dark colour,
 *     making all text invisible against the dark overlay background.
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready first time
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { HelpCircle, X, ChevronDown } from 'lucide-react';
import { PAGE_HELP_CONTENT } from '@config/helpContent';
import type { PageHelpKey } from '@config/helpContent';

// =============================================
// PROPS
// =============================================
interface PageHelpProps {
  /** Key matching a page in PAGE_HELP_CONTENT */
  pageKey: PageHelpKey;
}

// =============================================
// ACCORDION SECTION
// =============================================
function HelpAccordion({
  heading,
  items,
  iconColour,
  iconBg,
  isOpen,
  onToggle,
}: {
  heading: string;
  items: string[];
  iconColour: string;
  iconBg: string;
  isOpen: boolean;
  onToggle: () => void;
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [items, isOpen]);

  return (
    <div className="rounded-xl border border-[#2A2F3A] bg-[#131720] overflow-hidden transition-colors hover:border-[#3A3F4A]">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left focus:outline-none focus:ring-2 focus:ring-[#22C55E]/50 focus:ring-inset"
        aria-expanded={isOpen}
      >
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <HelpCircle className={`w-4 h-4 ${iconColour}`} />
        </div>
        {/* Hardcoded white — overlay is always dark */}
        <span className="text-sm font-semibold text-white flex-1">{heading}</span>
        <ChevronDown
          className={`w-4 h-4 text-[#6B7280] transition-transform duration-200 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expandable content */}
      <div
        style={{
          maxHeight: isOpen ? `${contentHeight}px` : '0px',
          opacity: isOpen ? 1 : 0,
        }}
        className="transition-all duration-250 ease-in-out overflow-hidden"
      >
        <div ref={contentRef} className="px-4 pb-4 pt-1">
          <div className="border-t border-[#2A2F3A] pt-3">
            <ol className="space-y-2.5">
              {items.map((item, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className={`w-5 h-5 rounded-full ${iconBg} ${iconColour} text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    {idx + 1}
                  </span>
                  {/* Hardcoded #9CA3AF — overlay is always dark */}
                  <span className="text-sm text-[#9CA3AF] leading-relaxed">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================
// SECTION COLOUR PALETTE
// =============================================
const SECTION_STYLES: Array<{ colour: string; bg: string }> = [
  { colour: 'text-[#22C55E]', bg: 'bg-[#22C55E]/10' },
  { colour: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]/10' },
  { colour: 'text-[#F59E0B]', bg: 'bg-[#F59E0B]/10' },
  { colour: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
  { colour: 'text-[#EC4899]', bg: 'bg-[#EC4899]/10' },
  { colour: 'text-[#06B6D4]', bg: 'bg-[#06B6D4]/10' },
  { colour: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10' },
  { colour: 'text-[#10B981]', bg: 'bg-[#10B981]/10' },
];

function getSectionStyle(index: number): { colour: string; bg: string } {
  return SECTION_STYLES[index % SECTION_STYLES.length] ?? SECTION_STYLES[0]!;
}

// =============================================
// MAIN COMPONENT
// =============================================
export function PageHelp({ pageKey }: PageHelpProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const overlayRef = useRef<HTMLDivElement>(null);
  const content = PAGE_HELP_CONTENT[pageKey];

  // ---- Open with first section expanded ----
  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setOpenSections(new Set([0]));
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // ---- Toggle accordion section ----
  const toggleSection = useCallback((index: number) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // ---- Escape key closes overlay ----
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // ---- Prevent body scroll when open ----
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ---- Focus overlay on open ----
  useEffect(() => {
    if (isOpen && overlayRef.current) {
      overlayRef.current.focus();
    }
  }, [isOpen]);

  if (!content) return <></>;

  return (
    <>
      {/* ── Floating Help Button (fixed bottom-right, above mobile nav) ── */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleOpen}
          className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full
            bg-[#22C55E] text-white shadow-lg shadow-[#22C55E]/25
            flex items-center justify-center
            hover:bg-[#16A34A] active:scale-95
            transition-all duration-150
            focus:outline-none focus:ring-2 focus:ring-[#22C55E] focus:ring-offset-2 focus:ring-offset-[#0C0F14]
            sm:bottom-6 sm:right-6"
          aria-label={`Help: ${content.title}`}
        >
          <HelpCircle className="w-6 h-6" />
        </button>
      )}

      {/* ── Full-Screen Help Overlay ── */}
      {isOpen && (
        <div
          ref={overlayRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-[#0C0F14] overflow-y-auto animate-help-fade-in focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={`${content.title} help`}
        >
          {/* ── Header ── */}
          <div className="sticky top-0 z-10 bg-[#0C0F14]/95 backdrop-blur-md border-b border-[#2A2F3A]">
            <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#22C55E]/15 flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-[#22C55E]" />
                </div>
                {/* Hardcoded white — overlay is always dark */}
                <h2 className="text-base font-bold text-white">{content.title}</h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center
                  text-[#6B7280] hover:text-white hover:bg-[#1C2029]
                  transition-colors focus:outline-none focus:ring-2 focus:ring-[#22C55E]/50"
                aria-label="Close help"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ── Content ── */}
          <div className="max-w-lg mx-auto px-5 py-6">
            {/* Summary — hardcoded #9CA3AF, overlay is always dark */}
            <p className="text-sm text-[#9CA3AF] leading-relaxed mb-6">{content.summary}</p>

            {/* Accordion sections */}
            <div className="space-y-3">
              {content.sections.map((section, idx) => {
                const style = getSectionStyle(idx);
                return (
                  <HelpAccordion
                    key={idx}
                    heading={section.heading}
                    items={section.items}
                    iconColour={style.colour}
                    iconBg={style.bg}
                    isOpen={openSections.has(idx)}
                    onToggle={() => toggleSection(idx)}
                  />
                );
              })}
            </div>

            {/* Footer — hardcoded #9CA3AF, overlay is always dark */}
            <p className="text-center text-xs text-[#9CA3AF] mt-8 mb-4">
              Need more help? Email{' '}
              <a
                href="mailto:support@inspectvoice.co.uk"
                className="text-[#22C55E] hover:underline"
              >
                support@inspectvoice.co.uk
              </a>
            </p>
          </div>
        </div>
      )}

      {/* ── Animation ── */}
      <style>{`
        @keyframes help-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-help-fade-in {
          animation: help-fade-in 0.2s ease-out;
        }
      `}</style>
    </>
  );
}

export default PageHelp;
