import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { VAT_RATES } from "@/lib/db/seed-data";
import { ProductForm } from "./_components/product-form";
import { updateProduct, createProduct } from "./_actions";
import { formatEurUnit, formatPct, marginPct } from "@/lib/format";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [suppliers, families] = await Promise.all([
    db
      .select({ code: schema.suppliers.code, name: schema.suppliers.name })
      .from(schema.suppliers)
      .orderBy(asc(schema.suppliers.code)),
    db
      .select({ code: schema.productFamilies.code, label: schema.productFamilies.label })
      .from(schema.productFamilies)
      .orderBy(asc(schema.productFamilies.code)),
  ]);

  const vatRates = VAT_RATES.map((v) => ({ rate: v.rate, label: v.label }));

  if (id === "new") {
    return (
      <div className="max-w-4xl">
        <Header backLabel="‹ Catalogue" backHref="/products" title="Nouveau produit" />
        <div className="mt-6">
          <ProductForm
            mode="create"
            initial={{ active: true, vatRate: "20.00" }}
            suppliers={suppliers}
            families={families}
            vatRates={vatRates}
            action={createProduct}
          />
        </div>
      </div>
    );
  }

  const p = await db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      designation: schema.products.designation,
      conditionnement: schema.products.conditionnement,
      moq: schema.products.moq,
      purchasePriceHt: schema.products.purchasePriceHt,
      defaultSalePriceHt: schema.products.defaultSalePriceHt,
      vatRate: schema.products.vatRate,
      ftUrl: schema.products.ftUrl,
      fdsUrl: schema.products.fdsUrl,
      pictureUrl: schema.products.pictureUrl,
      weightKg: schema.products.weightKg,
      volumeL: schema.products.volumeL,
      active: schema.products.active,
      supplierCode: schema.suppliers.code,
      familyCode: schema.productFamilies.code,
    })
    .from(schema.products)
    .leftJoin(schema.suppliers, eq(schema.products.supplierId, schema.suppliers.id))
    .leftJoin(schema.productFamilies, eq(schema.products.familyId, schema.productFamilies.id))
    .where(eq(schema.products.id, id))
    .limit(1)
    .then((r) => r[0]);

  if (!p) notFound();

  const m = marginPct(p.purchasePriceHt, p.defaultSalePriceHt);

  return (
    <div className="max-w-4xl">
      <Header
        backLabel="‹ Catalogue"
        backHref="/products"
        title={p.designation}
        subtitle={
          <span className="font-mono text-xs text-neutral-500">{p.code}</span>
        }
      />

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="PA HT" value={formatEurUnit(p.purchasePriceHt)} />
        <Stat label="PDV HT" value={formatEurUnit(p.defaultSalePriceHt)} />
        <Stat label="Marge" value={m === null ? "—" : formatPct(m)} />
      </div>

      <div className="mt-6">
        <ProductForm
          mode="edit"
          initial={{
            code: p.code,
            designation: p.designation,
            conditionnement: p.conditionnement,
            moq: p.moq,
            supplierCode: p.supplierCode,
            familyCode: p.familyCode,
            purchasePriceHt: p.purchasePriceHt,
            defaultSalePriceHt: p.defaultSalePriceHt,
            vatRate: p.vatRate,
            ftUrl: p.ftUrl,
            fdsUrl: p.fdsUrl,
            pictureUrl: p.pictureUrl,
            weightKg: p.weightKg,
            volumeL: p.volumeL,
            active: p.active,
          }}
          suppliers={suppliers}
          families={families}
          vatRates={vatRates}
          action={updateProduct.bind(null, p.id)}
        />
      </div>
    </div>
  );
}

function Header({
  backLabel,
  backHref,
  title,
  subtitle,
}: {
  backLabel: string;
  backHref: string;
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div>
      <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900">
        {backLabel}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      {subtitle ? <div className="mt-1">{subtitle}</div> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="mt-1 tabular-nums">{value}</div>
    </div>
  );
}
