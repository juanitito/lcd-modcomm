"use client";

import { useRef, useState, useTransition } from "react";
import { uploadInvoicePdfs } from "../_actions";

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) => {
        for (const f of files) fd.append("files", f);
        setError(null);
        startTransition(async () => {
          try {
            await uploadInvoicePdfs(fd);
            setFiles([]);
            if (inputRef.current) inputRef.current.value = "";
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        });
      }}
      className="rounded-lg border border-dashed border-neutral-300 bg-white p-6"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-sm"
        />
        <button
          type="submit"
          disabled={isPending || files.length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending
            ? "Traitement…"
            : `Importer ${files.length || ""} PDF${files.length > 1 ? "s" : ""}`}
        </button>
      </div>
      {files.length > 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          {files.length} fichier{files.length > 1 ? "s" : ""} prêt
          {files.length > 1 ? "s" : ""} : {files.map((f) => f.name).join(", ")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <p className="mt-3 text-xs text-neutral-500">
        L&apos;extraction LLM peut prendre 5-15s par PDF. Reste sur la page
        jusqu&apos;à la fin.
      </p>
    </form>
  );
}
