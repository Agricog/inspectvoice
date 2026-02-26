/**
 * InspectVoice — Portal Defect Detail Page
 * src/portal/pages/DefectDetailPage.tsx
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDefect, submitDefectUpdate, type PortalDefect, type PortalDefectUpdate } from '../api/portalApi';
import { LoadingSkeleton, ErrorCard, SeverityBadge, StatusBadge, fmtDate } from './DashboardPage';

export function DefectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [defect, setDefect] = useState<PortalDefect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    fetchDefect(id)
      .then(setDefect)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorCard message={error} />;
  if (!defect) return null;

  return (
    <div className="space-y-6">
      <Link to="/portal/defects" className="text-sm text-blue-600 hover:text-blue-800">
        ← Back to defects
      </Link>

      {/* Defect header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SeverityBadge severity={defect.severity} />
          <StatusBadge status={defect.status} />
        </div>
        <p className="text-gray-900">{defect.description}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100 text-sm">
          <Detail label="Site" value={defect.site_name} />
          <Detail label="Asset" value={defect.asset_code ?? '—'} />
          <Detail label="Category" value={defect.defect_category?.replace(/_/g, ' ') ?? '—'} />
          <Detail label="BS EN Ref" value={defect.bs_en_reference ?? '—'} />
          <Detail label="Due Date" value={defect.due_date ? fmtDate(defect.due_date) : '—'} />
          <Detail label="Created" value={fmtDate(defect.created_at)} />
          {defect.estimated_cost_gbp != null && (
            <Detail label="Est. Cost" value={`£${defect.estimated_cost_gbp.toLocaleString()}`} />
          )}
          {defect.resolved_at && <Detail label="Resolved" value={fmtDate(defect.resolved_at)} />}
        </div>

        {defect.resolution_notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Resolution Notes</p>
            <p className="text-sm text-gray-700">{defect.resolution_notes}</p>
          </div>
        )}
      </div>

      {/* Submit update form (only if defect isn't resolved/verified) */}
      {!['resolved', 'verified'].includes(defect.status) && id && (
        <UpdateForm defectId={id} onSubmitted={load} />
      )}

      {/* Update history */}
      {defect.client_updates.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Update History ({defect.client_updates.length})</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {defect.client_updates.map((u) => (
              <UpdateRow key={u.id} update={u} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Update form ──

const UPDATE_TYPES = [
  { value: 'acknowledged', label: 'Acknowledge', desc: 'Confirm you are aware of this defect' },
  { value: 'comment', label: 'Comment', desc: 'Add a note or update' },
  { value: 'contractor_booked', label: 'Contractor Booked', desc: 'Repair contractor has been scheduled' },
  { value: 'work_complete', label: 'Work Complete', desc: 'Remedial work has been done (requires description)' },
  { value: 'unable_to_action', label: 'Unable to Action', desc: 'Cannot address this defect' },
] as const;

function UpdateForm({ defectId, onSubmitted }: { defectId: string; onSubmitted: () => void }) {
  const [updateType, setUpdateType] = useState<string>('acknowledged');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccess(false);

    if (updateType === 'work_complete' && !comment.trim()) {
      setSubmitError('Please describe the work completed.');
      return;
    }

    setSubmitting(true);
    try {
      await submitDefectUpdate(defectId, {
        update_type: updateType as 'acknowledged',
        comment: comment.trim() || undefined,
      });
      setSuccess(true);
      setComment('');
      setUpdateType('acknowledged');
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit update');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-4">Submit Update</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Update type */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {UPDATE_TYPES.map((t) => (
            <label
              key={t.value}
              className={`
                flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                ${updateType === t.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
                }
              `}
            >
              <input
                type="radio"
                name="update_type"
                value={t.value}
                checked={updateType === t.value}
                onChange={(e) => setUpdateType(e.target.value)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{t.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
              </div>
            </label>
          ))}
        </div>

        {/* Comment */}
        <div>
          <label htmlFor="comment" className="block text-sm font-medium text-gray-700 mb-1">
            Comment {updateType === 'work_complete' && <span className="text-red-500">*</span>}
          </label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={
              updateType === 'work_complete'
                ? 'Describe the work completed...'
                : 'Optional comment...'
            }
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
        </div>

        {submitError && (
          <p className="text-sm text-red-600">{submitError}</p>
        )}
        {success && (
          <p className="text-sm text-green-600">Update submitted successfully. Awaiting inspector verification.</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Update'}
        </button>
      </form>
    </div>
  );
}

// ── Update history row ──

function UpdateRow({ update }: { update: PortalDefectUpdate }) {
  const typeColors: Record<string, string> = {
    acknowledged: 'bg-blue-100 text-blue-700',
    comment: 'bg-gray-100 text-gray-700',
    work_complete: 'bg-green-100 text-green-700',
    contractor_booked: 'bg-purple-100 text-purple-700',
    unable_to_action: 'bg-red-100 text-red-700',
  };

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColors[update.update_type] ?? 'bg-gray-100 text-gray-600'}`}>
          {update.update_type.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-gray-500">by {update.client_user_name}</span>
        <span className="text-xs text-gray-400">{fmtDate(update.created_at)}</span>

        {update.inspector_verified && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Verified</span>
        )}
        {!update.inspector_verified && update.proposed_status && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending verification</span>
        )}
      </div>

      {update.comment && <p className="text-sm text-gray-700 mt-1">{update.comment}</p>}

      {update.inspector_notes && (
        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
          Inspector notes: {update.inspector_notes}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-gray-700 mt-0.5">{value}</p>
    </div>
  );
}
