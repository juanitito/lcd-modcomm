"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Option = { value: string; label: string };

export function FilterSelect({
  name,
  value,
  options,
  placeholder,
  basePath,
}: {
  name: string;
  value: string;
  options: Option[];
  placeholder: string;
  basePath: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(name, e.target.value);
        else next.delete(name);
        next.delete("page");
        router.replace(`${basePath}?${next.toString()}`);
      }}
      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
