"use client";

import * as React from "react";

import { authFetch } from "@/lib/auth-fetch";
import {
  parseEuiccProfiles,
  type EuiccProfile,
  type EuiccProfileState,
} from "@/lib/euicc";

const STATUS_ENDPOINT = "/cgi-bin/quecmanager/euicc/status.sh";
const ACTION_ENDPOINT = "/cgi-bin/quecmanager/euicc/profile.sh";
const DOWNLOAD_ENDPOINT = "/cgi-bin/quecmanager/euicc/download.sh";
const DOWNLOAD_STATUS_ENDPOINT =
  "/cgi-bin/quecmanager/euicc/download_status.sh";

/**
 * A profile download is an SM-DP+ round trip: ES9+ auth, BPP download and
 * ES10b install. It usually takes seconds but can take minutes on a slow link.
 */
const DOWNLOAD_POLL_DELAY_MS = 2000;
const DOWNLOAD_MAX_ATTEMPTS = 150;

/**
 * A profile switch triggers UICC REFRESH. The modem drops off the network and
 * its HTTP server can be unreachable for roughly 30–60 seconds, so the client
 * waits it out and re-reads the card instead of trusting the write response.
 */
const REFRESH_RETRY_DELAY_MS = 3000;
const REFRESH_MAX_ATTEMPTS = 20;

export interface EuiccStatus {
  eid: string;
  profiles: EuiccProfile[];
}

export type EuiccAction = "enable" | "disable" | "delete";

export interface EuiccActionResult {
  ok: boolean;
  /** Machine-readable failure, mapped to a translated message by the caller. */
  error?: "action_failed" | "refresh_timeout" | "state_not_changed";
  detail?: string;
}

interface StatusResponse {
  success?: boolean;
  eid?: string;
  profiles_raw?: string;
  detail?: string;
  error?: string;
}

interface ActionResponse {
  success?: boolean;
  detail?: string;
  error?: string;
}

interface DownloadResponse {
  success?: boolean;
  detail?: string;
  error?: string;
}

interface DownloadStatus {
  state?: "idle" | "running" | "success" | "failed";
  message?: string;
  detail?: string;
  iccid?: string;
  profile_name?: string;
}

export interface EuiccDownloadResult {
  ok: boolean;
  error?: "download_failed" | "refresh_timeout";
  detail?: string;
  iccid?: string;
  profileName?: string;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function desiredState(action: EuiccAction): EuiccProfileState | null {
  if (action === "enable") return "enabled";
  if (action === "disable") return "disabled";
  return null;
}

export interface UseEuiccReturn {
  data: EuiccStatus | null;
  isLoading: boolean;
  isMutating: boolean;
  isDownloading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  runAction: (
    action: EuiccAction,
    profile: EuiccProfile,
  ) => Promise<EuiccActionResult>;
  downloadProfile: (
    activationCode: string,
    confirmationCode?: string,
  ) => Promise<EuiccDownloadResult>;
}

export function useEuicc(): UseEuiccReturn {
  const [data, setData] = React.useState<EuiccStatus | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isMutating, setIsMutating] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readStatus = React.useCallback(async (): Promise<EuiccStatus> => {
    const resp = await authFetch(STATUS_ENDPOINT, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = (await resp.json()) as StatusResponse;
    if (!json.success) {
      throw new Error(json.detail || json.error || "euicc_read_failed");
    }

    return {
      eid: json.eid ?? "",
      profiles: parseEuiccProfiles(json.profiles_raw ?? ""),
    };
  }, []);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await readStatus();
      if (mountedRef.current) setData(next);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "euicc_read_failed");
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [readStatus]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Re-read until the modem answers again, then check the card state rather
   * than the write response. A switch can report a non-zero ES10c result and
   * still have changed profile (observed on RG520N-EB), so state is the proof.
   */
  const waitForProfileState = React.useCallback(
    async (
      action: EuiccAction,
      profile: EuiccProfile,
    ): Promise<EuiccActionResult> => {
      let sawWrongState = false;

      for (let attempt = 0; attempt < REFRESH_MAX_ATTEMPTS; attempt += 1) {
        // Always wait before the first read: the write response can arrive
        // while the UICC REFRESH is still tearing the data path down.
        await delay(REFRESH_RETRY_DELAY_MS);

        try {
          const next = await readStatus();
          if (!mountedRef.current) return { ok: false, error: "action_failed" };

          setData(next);
          setError(null);

          const target = next.profiles.find(
            (candidate) => candidate.iccidHex === profile.iccidHex,
          );
          const expected = desiredState(action);

          if (expected === null) {
            if (!target) return { ok: true };
            sawWrongState = true;
            continue;
          }

          if (target?.state === expected) return { ok: true };

          // A read can land between REFRESH stages. Keep polling rather than
          // declaring failure on the first stale snapshot.
          if (target) sawWrongState = true;
        } catch {
          // The modem is still refreshing. Keep waiting.
        }
      }

      return {
        ok: false,
        error: sawWrongState ? "state_not_changed" : "refresh_timeout",
      };
    },
    [readStatus],
  );

  const runAction = React.useCallback(
    async (
      action: EuiccAction,
      profile: EuiccProfile,
    ): Promise<EuiccActionResult> => {
      setIsMutating(true);
      setError(null);

      let detail: string | undefined;

      try {
        try {
          const resp = await authFetch(ACTION_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              iccid: profile.iccid,
              iccid_hex: profile.iccidHex,
            }),
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const json = (await resp.json()) as ActionResponse;
          if (!json.success) {
            return {
              ok: false,
              error: "action_failed",
              detail: json.detail || json.error,
            };
          }
        } catch (err) {
          // A write can still land even when the HTTP response is lost in the
          // REFRESH. Keep the detail and let the read-back decide.
          detail = err instanceof Error ? err.message : undefined;
        }

        const result = await waitForProfileState(action, profile);
        return result.ok ? result : { ...result, detail };
      } finally {
        if (mountedRef.current) setIsMutating(false);
      }
    },
    [waitForProfileState],
  );

  const downloadProfile = React.useCallback(
    async (
      activationCode: string,
      confirmationCode?: string,
    ): Promise<EuiccDownloadResult> => {
      setIsDownloading(true);
      setError(null);

      let startDetail: string | undefined;

      try {
        try {
          const resp = await authFetch(DOWNLOAD_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              activation_code: activationCode,
              confirmation_code: confirmationCode ?? "",
            }),
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const json = (await resp.json()) as DownloadResponse;
          if (!json.success) {
            return {
              ok: false,
              error: "download_failed",
              detail: json.detail || json.error,
            };
          }
        } catch (err) {
          // The background job may still be running even if the start response
          // was lost. The status file decides.
          startDetail = err instanceof Error ? err.message : undefined;
        }

        for (
          let attempt = 0;
          attempt < DOWNLOAD_MAX_ATTEMPTS;
          attempt += 1
        ) {
          await delay(DOWNLOAD_POLL_DELAY_MS);

          try {
            const resp = await authFetch(DOWNLOAD_STATUS_ENDPOINT, {
              cache: "no-store",
            });
            if (!resp.ok) continue;

            const status = (await resp.json()) as DownloadStatus;
            if (!mountedRef.current) return { ok: false, error: "download_failed" };

            if (status.state === "success") {
              await refresh();
              return {
                ok: true,
                iccid: status.iccid,
                profileName: status.profile_name,
              };
            }

            if (status.state === "failed") {
              return {
                ok: false,
                error: "download_failed",
                detail: status.detail || status.message,
              };
            }

            if (status.state === "idle" && startDetail) {
              return {
                ok: false,
                error: "download_failed",
                detail: startDetail,
              };
            }
          } catch {
            // Keep polling through a transient modem/HTTP hiccup.
          }
        }

        return { ok: false, error: "refresh_timeout" };
      } finally {
        if (mountedRef.current) setIsDownloading(false);
      }
    },
    [refresh],
  );

  return {
    data,
    isLoading,
    isMutating,
    isDownloading,
    error,
    refresh,
    runAction,
    downloadProfile,
  };
}
