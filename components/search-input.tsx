"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function SearchInput({
  initial,
  basePath,
  placeholder,
}: {
  initial: string;
  basePath: string;
  placeholder: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("page");
      startTransition(() => {
        router.replace(`${basePath}?${next.toString()}`);
      });
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      {isPending ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
          …
        </span>
      ) : null}
    </div>
  );
}
