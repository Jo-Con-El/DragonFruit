'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchUpdateInfo,
  downloadAndInstall,
  type UpdateInfo,
  type DownloadProgress,
} from '@/features/updater/updateBridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'up-to-date'; info: UpdateInfo }
  | { status: 'error'; message: string }
  | { status: 'downloading'; progress: DownloadProgress }
  | { status: 'installing' }
  | { status: 'installed' };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const STORAGE_KEY_LAST_CHECK = 'dragonfruit-updater-last-check';

export function useUpdateChecker() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);

  const handleCheck = useCallback(async () => {
    setState({ status: 'checking' });

    try {
      const info = await fetchUpdateInfo();
      if (!info) {
        setState({
          status: 'error',
          message:
            'Could not check for updates. Make sure you are running the desktop version of DragonFruit.',
        });
        return;
      }

      // The plugin's check() returns null when no update is available,
      // but if it returns, the update IS available (semver comparison is
      // done server-side by the static JSON / endpoint).
      setState({ status: 'available', info });

      // Persist the last check timestamp.
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            STORAGE_KEY_LAST_CHECK,
            Date.now().toString(),
          );
        } catch {
          // Ignore storage errors.
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error checking for updates.';
      setState({ status: 'error', message });
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    setState({ status: 'downloading', progress: { contentLength: 0, downloaded: 0 } });

    const success = await downloadAndInstall((progress: DownloadProgress) => {
      setState({ status: 'downloading', progress });
    });

    if (success) {
      // The app should relaunch — if we get here, show installed state.
      setState({ status: 'installed' });
    } else {
      setState({
        status: 'error',
        message: 'Download or install failed. Please try again.',
      });
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  // Auto-check on mount if enough time has passed.
  useEffect(() => {
    if (!autoCheckEnabled) return;

    const lastCheck = (() => {
      if (typeof window === 'undefined') return 0;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY_LAST_CHECK);
        return raw ? parseInt(raw, 10) : 0;
      } catch {
        return 0;
      }
    })();

    const elapsed = Date.now() - lastCheck;
    if (elapsed >= CHECK_INTERVAL_MS || lastCheck === 0) {
      handleCheck();
    }
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckEnabled]);

  return {
    state,
    autoCheckEnabled,
    setAutoCheckEnabled,
    checkForUpdates: handleCheck,
    downloadAndInstall: handleDownloadAndInstall,
    dismiss: handleDismiss,
  };
}
