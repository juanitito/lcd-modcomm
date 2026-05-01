export function ComingSoon({ title, todos }: { title: string; todos: string[] }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-600">Module à venir.</p>
      <ul className="mt-6 space-y-2">
        {todos.map((t, i) => (
          <li
            key={i}
            className="rounded-md border border-dashed border-neutral-300 bg-white p-3 text-sm text-neutral-700"
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
