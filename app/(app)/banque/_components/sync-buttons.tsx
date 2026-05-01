"use client";

import { useState, useTransition } from "react";
import { syncQonto, autoMatchTransactions } from "../_actions";

export function SyncButtons() {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMsg(null);
            startTransition(async () => {
              try {
                const r = await syncQonto();
                setMsg(
                  `${r.newCount} nouvelles, ${r.updatedCount} mises à jour, ${r.accounts} compte(s).`,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending ? "Sync…" : "Synchroniser depuis Qonto"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMsg(null);
            startTransition(async () => {
              try {
                const r = await autoMatchTransactions();
                setMsg(
                  `${r.matched} matchées sur ${r.scanned} (${r.ambiguous} ambiguës laissées manuelles).`,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
        >
          Auto-matcher
        </button>
      </div>
      {msg ? <p className="text-xs text-emerald-700">{msg}</p> : null}
      {error ? <p className="max-w-md text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
