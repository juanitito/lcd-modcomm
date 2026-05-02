// Client Qonto Business API v2.
// Auth : header `Authorization: <login>:<secret-key>` (concat avec `:`, pas de Base64).
// Doc : https://docs.qonto.com/api-reference/business-api/

const BASE_URL = "https://thirdparty.qonto.com/v2";

function authHeader(): string {
  const login = process.env.QONTO_LOGIN;
  const key = process.env.QONTO_API_KEY;
  if (!login || !key) {
    throw new Error(
      "QONTO_LOGIN et QONTO_API_KEY requis (Integrations & Partnerships → API key dans Qonto).",
    );
  }
  return `${login}:${key}`;
}

async function qontoFetch<T>(
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qonto API ${res.status} sur ${path} : ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------- Types ----------

export type QontoBankAccount = {
  id: string;
  slug: string;
  iban: string | null;
  balance: number;
  balance_cents: number;
  currency: string;
  status: string;
  main: boolean;
};

export type QontoOrganization = {
  organization: {
    id: string;
    slug: string;
    legal_name: string;
    bank_accounts: QontoBankAccount[];
  };
};

export type QontoSide = "debit" | "credit";

export type QontoTransaction = {
  id: string;
  transaction_id: string;
  amount: number;
  amount_cents: number;
  side: QontoSide;
  operation_type: string;
  currency: string;
  label: string;
  clean_counterparty_name: string | null;
  settled_at: string | null;
  emitted_at: string;
  updated_at: string;
  status: "pending" | "declined" | "completed";
  reference: string | null;
  note: string | null;
  vat_amount: number | null;
  vat_rate: number | null;
  attachment_ids: string[];
  bank_account_id: string;
  cashflow_category: { name: string } | null;
  cashflow_subcategory: { name: string } | null;
  subject_type: string;
  // pas tout listé — on stocke aussi le brut dans rawJson
};

export type QontoTransactionsResponse = {
  transactions: QontoTransaction[];
  meta: {
    current_page: number;
    next_page: number | null;
    total_count: number;
    total_pages: number;
    per_page: number;
  };
};

// ---------- Statements ----------

export type QontoStatement = {
  id: string;
  bank_account_id: string;
  period: string; // MM-YYYY
  file: {
    file_name: string;
    file_content_type: string;
    file_size: string;
    file_url: string; // expire après 30 min
  };
};

export type QontoStatementsResponse = {
  statements: QontoStatement[];
  meta: {
    current_page: number;
    next_page: number | null;
    total_count: number;
    total_pages: number;
    per_page: number;
  };
};

export async function listStatementsPage(opts?: {
  bankAccountId?: string;
  page?: number;
  perPage?: number;
}): Promise<QontoStatementsResponse> {
  return qontoFetch<QontoStatementsResponse>("/statements", {
    "bank_account_ids[]": opts?.bankAccountId,
    page: opts?.page ?? 1,
    per_page: opts?.perPage ?? 100,
    sort_by: "period:desc",
  });
}

export async function* iterateStatements(opts?: {
  bankAccountId?: string;
}): AsyncGenerator<QontoStatement[], void, void> {
  let page = 1;
  while (true) {
    const r = await listStatementsPage({ ...opts, page });
    yield r.statements;
    if (!r.meta.next_page) return;
    page = r.meta.next_page;
  }
}

// Récupère un statement à la demande (l'URL de file expire vite, donc
// on refetch avant chaque téléchargement).
export async function getStatement(id: string): Promise<QontoStatement> {
  const r = await qontoFetch<{ statement: QontoStatement }>(`/statements/${id}`);
  return r.statement;
}

// ---------- Attachments ----------

export type QontoAttachment = {
  id: string;
  file_name: string;
  file_size: number;
  file_content_type: string | null;
  url: string; // URL S3 signée (TTL court)
  created_at: string;
  probative_attachment?: { status: string };
};

export async function getAttachment(
  attachmentId: string,
): Promise<QontoAttachment> {
  const r = await qontoFetch<{ attachment: QontoAttachment }>(
    `/attachments/${attachmentId}`,
  );
  return r.attachment;
}

// ---------- API helpers ----------

export async function getOrganization(): Promise<QontoOrganization> {
  return qontoFetch<QontoOrganization>("/organization");
}

export async function listTransactionsPage(opts: {
  bankAccountId: string;
  settledAtFrom?: string; // ISO 8601
  page?: number;
  perPage?: number;
}): Promise<QontoTransactionsResponse> {
  return qontoFetch<QontoTransactionsResponse>("/transactions", {
    bank_account_id: opts.bankAccountId,
    settled_at_from: opts.settledAtFrom,
    "status[]": "completed",
    sort_by: "settled_at:desc",
    page: opts.page ?? 1,
    per_page: opts.perPage ?? 100,
  });
}

// Itère toutes les pages, retourne tout.
export async function* iterateTransactions(opts: {
  bankAccountId: string;
  settledAtFrom?: string;
}): AsyncGenerator<QontoTransaction[], void, void> {
  let page = 1;
  while (true) {
    const r = await listTransactionsPage({ ...opts, page });
    yield r.transactions;
    if (!r.meta.next_page) return;
    page = r.meta.next_page;
  }
}

// Convertit le format Qonto vers les colonnes de notre table qonto_transactions.
export function toQontoRow(tx: QontoTransaction) {
  // Side credit = entrée (positif), debit = sortie (négatif)
  const signed = tx.side === "credit" ? tx.amount : -tx.amount;
  const settledAt = tx.settled_at ? new Date(tx.settled_at) : null;
  // emitted_at toujours présent ; on prend la date du jour calendaire
  const date = (tx.settled_at ?? tx.emitted_at).slice(0, 10);
  return {
    qontoId: tx.id,
    date,
    settledAt,
    amount: signed.toFixed(2),
    currency: tx.currency,
    label: tx.label,
    counterpartyName: tx.clean_counterparty_name ?? tx.label,
    qontoCategory: tx.cashflow_category?.name ?? null,
    attachmentUrl: null as string | null,
    rawJson: tx as unknown as Record<string, unknown>,
  };
}
