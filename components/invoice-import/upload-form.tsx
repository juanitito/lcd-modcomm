"use client";

import { useRef, useState, useTransition } from "react";
import { uploadInvoicePdfs } from "@/lib/invoice-import-actions";

type Direction = "client" | "supplier";

export function UploadForm({ direction }: { direction: Direction }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: File[]) => {
    const pdfs = incoming.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length === 0) {
      setError("Seuls les PDFs sont acceptés.");
      return;
    }
    setError(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const fresh = pdfs.filter((f) => !seen.has(`${f.name}:${f.size}`));
      return [...prev, ...fresh];
    });
  };

  const submit = () => {
    if (files.length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.append("direction", direction);
    for (const f of files) fd.append("files", f);
    startTransition(async () => {
      try {
        await uploadInvoicePdfs(fd);
        setFiles([]);
        if (inputRef.current) inputRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="grid gap-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`block w-full cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-neutral-500 bg-neutral-50"
            : "border-neutral-300 bg-white hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          className="hidden"
        />
        <div className="text-sm font-medium text-neutral-700">
          Clique ici pour choisir des PDFs (ou glisse-dépose plusieurs fichiers)
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {direction === "client"
            ? "Factures que TU as émises à tes clients."
            : "Factures que tu as REÇUES de tes fournisseurs."}{" "}
          Cmd/Ctrl+clic dans la fenêtre pour multi-sélection. L&apos;extraction
          LLM prend 5-15s par PDF.
        </div>
      </label>

      {files.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="mb-2 text-xs font-medium text-neutral-700">
            {files.length} fichier{files.length > 1 ? "s" : ""} prêt
            {files.length > 1 ? "s" : ""} :
          </div>
          <ul className="grid gap-1 text-xs text-neutral-600">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {f.name}{" "}
                  <span className="text-neutral-400">
                    ({(f.size / 1024).toFixed(0)} ko)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  disabled={isPending}
                  className="text-neutral-400 hover:text-red-600"
                  aria-label="Retirer"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          {files.length === 0
            ? "Sélectionne au moins un PDF pour activer l'import."
            : `${files.length} PDF${files.length > 1 ? "s" : ""} prêt${files.length > 1 ? "s" : ""} à importer.`}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || files.length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isPending
            ? "Traitement…"
            : files.length === 0
              ? "Importer (aucun fichier)"
              : `Importer ${files.length} PDF${files.length > 1 ? "s" : ""}`}
        </button>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
