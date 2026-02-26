/**
 * InspectVoice — Defect Library Hook
 * Feature 15: API integration for quick-pick and library queries
 *
 * Usage:
 *   const { items, loading, fetchQuickPick } = useDefectLibrary();
 *   fetchQuickPick('swing');
 *
 * Build Standard: Autaimate v3 — TypeScript strict, zero any
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import type { QuickPickItem } from '@components/DefectQuickPick';

interface UseDefectLibraryReturn {
  /** Quick-pick items for current asset type */
  readonly items: QuickPickItem[];
  /** Loading state */
  readonly loading: boolean;
  /** Fetch quick-pick items for an asset type */
  readonly fetchQuickPick: (assetType: string, limit?: number) => Promise<void>;
  /** Record that an entry was used (fire-and-forget) */
  readonly recordUsage: (entryId: string) => void;
  /** Search the full library */
  readonly searchLibrary: (params: LibrarySearchParams) => Promise<LibrarySearchResult>;
}

export interface LibrarySearchParams {
  readonly asset_type?: string;
  readonly source?: 'system' | 'org';
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LibrarySearchResult {
  readonly entries: QuickPickItem[];
  readonly total: number;
}

export function useDefectLibrary(): UseDefectLibraryReturn {
  const { getToken } = useAuth();
  const [items, setItems] = useState<QuickPickItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQuickPick = useCallback(async (assetType: string, limit = 12) => {
    if (!assetType) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/v1/defect-library/quick-pick/${encodeURIComponent(assetType)}?limit=${limit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const json = await res.json() as { data: QuickPickItem[] };
        setItems(json.data);
      }
    } catch {
      // Silent — quick-pick is non-critical
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  const recordUsage = useCallback((entryId: string) => {
    void (async () => {
      try {
        const token = await getToken();
        void fetch(`/api/v1/defect-library/${entryId}/record-usage`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Fire-and-forget
      }
    })();
  }, [getToken]);

  const searchLibrary = useCallback(async (params: LibrarySearchParams): Promise<LibrarySearchResult> => {
    try {
      const token = await getToken();
      const qs = new URLSearchParams();
      if (params.asset_type) qs.set('asset_type', params.asset_type);
      if (params.source) qs.set('source', params.source);
      if (params.search) qs.set('search', params.search);
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));

      const res = await fetch(`/api/v1/defect-library?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return { entries: [], total: 0 };

      const json = await res.json() as {
        data: QuickPickItem[];
        pagination: { total: number };
      };
      return { entries: json.data, total: json.pagination.total };
    } catch {
      return { entries: [], total: 0 };
    }
  }, [getToken]);

  return { items, loading, fetchQuickPick, recordUsage, searchLibrary };
}
