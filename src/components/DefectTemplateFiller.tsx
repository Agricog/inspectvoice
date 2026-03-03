/**
 * InspectVoice — Defect Template Filler
 *
 * Parses defect library templates containing [PLACEHOLDER] tokens and renders
 * a fill-in-the-blank UI with labeled inputs and a live assembled preview.
 *
 * When the description has no placeholders, falls back to a plain textarea.
 *
 * Usage:
 *   <DefectTemplateFiller
 *     value={defect.description}
 *     onChange={(filled) => updateDefect(idx, 'description', filled)}
 *   />
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any, production-ready
 */

import { useState, useRef, useMemo, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';

// =============================================
// TYPES
// =============================================

interface Segment {
  type: 'text' | 'placeholder';
  /** For text: the literal string. For placeholder: the hint label (e.g. "LOCATION") */
  value: string;
}

interface DefectTemplateFillerProps {
  /** Current description value (may contain [PLACEHOLDER] tokens) */
  value: string;
  /** Called with the assembled string whenever a field changes */
  onChange: (assembled: string) => void;
  /** Fallback placeholder for the plain textarea mode */
  placeholder?: string;
  /** Rows for the plain textarea fallback */
  rows?: number;
}

// =============================================
// TEMPLATE PARSER
// =============================================

/** Split a template string into text and placeholder segments */
function parseTemplate(template: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'placeholder', value: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIndex) });
  }

  return segments;
}

/** Check if a string contains any [PLACEHOLDER] tokens */
function hasPlaceholders(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}

// =============================================
// COMPONENT
// =============================================

export default function DefectTemplateFiller({
  value,
  onChange,
  placeholder = 'Describe the defect...',
  rows = 2,
}: DefectTemplateFillerProps): JSX.Element {
  // Store the original template on first mount — stays stable as user fills values
  const templateRef = useRef(value);
  const segments = useMemo(() => parseTemplate(templateRef.current), []);
  const isTemplate = useMemo(() => hasPlaceholders(templateRef.current), []);

  // Track filled values keyed by segment index
  const [filledValues, setFilledValues] = useState<Record<number, string>>({});

  // Free-text mode state (for non-template descriptions)
  const [freeText, setFreeText] = useState(value);

  // Handle placeholder input change
  const handleFill = useCallback(
    (segmentIndex: number, inputValue: string) => {
      const updated = { ...filledValues, [segmentIndex]: inputValue };
      setFilledValues(updated);

      // Reassemble full string — unfilled placeholders keep their [brackets]
      const assembled = segments
        .map((seg, idx) => {
          if (seg.type === 'text') return seg.value;
          const filled = updated[idx]?.trim();
          return filled ? filled : `[${seg.value}]`;
        })
        .join('');

      onChange(assembled);
    },
    [filledValues, segments, onChange],
  );

  // Handle free-text change
  const handleFreeTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setFreeText(e.target.value);
      onChange(e.target.value);
    },
    [onChange],
  );

  // ── No placeholders: plain textarea ──
  if (!isTemplate) {
    return (
      <textarea
        value={freeText}
        onChange={handleFreeTextChange}
        rows={rows}
        className="iv-input w-full text-sm resize-y"
        placeholder={placeholder}
      />
    );
  }

  // ── Template mode: live preview + labeled inputs ──

  const allFilled = segments.every(
    (seg, idx) => seg.type === 'text' || (filledValues[idx] && filledValues[idx].trim().length > 0),
  );

  return (
    <div className="space-y-2.5">
      {/* Live preview — assembled description with highlighted fills */}
      <div className="p-2.5 rounded-lg bg-[#151920] border border-[#2A2F3A]">
        <p className="text-2xs iv-muted mb-1.5 uppercase tracking-wider">Preview</p>
        <p className="text-sm leading-relaxed">
          {segments.map((seg, idx) => {
            if (seg.type === 'text') {
              return (
                <span key={idx} className="text-iv-text">
                  {seg.value}
                </span>
              );
            }
            const filled = filledValues[idx]?.trim();
            if (filled) {
              return (
                <span key={idx} className="text-iv-accent font-medium">
                  {filled}
                </span>
              );
            }
            return (
              <span key={idx} className="text-iv-muted-2 italic">
                [{seg.value}]
              </span>
            );
          })}
        </p>
        {allFilled && (
          <div className="flex items-center gap-1 mt-2 text-2xs text-[#22C55E]">
            <CheckCircle2 className="w-3 h-3" />
            All fields completed
          </div>
        )}
      </div>

      {/* Labeled input for each placeholder */}
      <div className="grid grid-cols-1 gap-2">
        {segments.map((seg, idx) => {
          if (seg.type !== 'placeholder') return null;
          return (
            <div key={idx}>
              <label className="text-2xs iv-muted uppercase tracking-wider mb-0.5 block">
                {seg.value}
              </label>
              <input
                type="text"
                value={filledValues[idx] ?? ''}
                onChange={(e) => handleFill(idx, e.target.value)}
                placeholder={`Enter ${seg.value.toLowerCase()}...`}
                className="iv-input w-full text-sm"
                aria-label={seg.value}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
