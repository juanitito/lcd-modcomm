"use client";

import { useState, useTransition } from "react";

export function LoginForm({ error, from }: { error?: string; from?: string }) {
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | undefined>(error);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(undefined);
    startTransition(async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, from }),
      });
      if (res.redirected) {
        window.location.href = res.url;
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSubmitError(data?.error ?? "Erreur de connexion");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Mot de passe</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
        />
      </label>
      {submitError && (
        <p className="text-sm text-red-600">{submitError}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 text-white py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
