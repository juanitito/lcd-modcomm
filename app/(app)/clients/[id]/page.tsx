import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ClientForm } from "./_components/client-form";
import { NegotiatedPrices } from "./_components/negotiated-prices";
import { createClient, updateClient } from "./_actions";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const categories = await db
    .select({
      code: schema.clientCategories.code,
      label: schema.clientCategories.label,
    })
    .from(schema.clientCategories)
    .orderBy(asc(schema.clientCategories.label));

  if (id === "new") {
    return (
      <div className="max-w-4xl">
        <Header backLabel="‹ Clients" backHref="/clients" title="Nouveau client" />
        <div className="mt-6">
          <ClientForm
            mode="create"
            initial={{ active: true, paymentTerms: "à réception" }}
            categories={categories}
            action={createClient}
          />
        </div>
      </div>
    );
  }

  const c = await db
    .select({
      id: schema.clients.id,
      code: schema.clients.code,
      name: schema.clients.name,
      legalName: schema.clients.legalName,
      siret: schema.clients.siret,
      vatNumber: schema.clients.vatNumber,
      iban: schema.clients.iban,
      billingAddress: schema.clients.billingAddress,
      billingCity: schema.clients.billingCity,
      billingZip: schema.clients.billingZip,
      shippingAddress: schema.clients.shippingAddress,
      shippingCity: schema.clients.shippingCity,
      shippingZip: schema.clients.shippingZip,
      geoZone: schema.clients.geoZone,
      defaultMarginPct: schema.clients.defaultMarginPct,
      paymentTerms: schema.clients.paymentTerms,
      contacts: schema.clients.contacts,
      active: schema.clients.active,
      categoryCode: schema.clientCategories.code,
    })
    .from(schema.clients)
    .leftJoin(
      schema.clientCategories,
      eq(schema.clients.categoryId, schema.clientCategories.id),
    )
    .where(eq(schema.clients.id, id))
    .limit(1)
    .then((r) => r[0]);

  if (!c) notFound();

  const negotiatedPrices = await db
    .select({
      productId: schema.products.id,
      code: schema.products.code,
      designation: schema.products.designation,
      conditionnement: schema.products.conditionnement,
      purchasePriceHt: schema.products.purchasePriceHt,
      defaultSalePriceHt: schema.products.defaultSalePriceHt,
      salePriceHt: schema.clientProductPrices.salePriceHt,
      marginPct: schema.clientProductPrices.marginPct,
      notes: schema.clientProductPrices.notes,
    })
    .from(schema.clientProductPrices)
    .innerJoin(
      schema.products,
      eq(schema.clientProductPrices.productId, schema.products.id),
    )
    .where(eq(schema.clientProductPrices.clientId, c.id))
    .orderBy(asc(schema.products.code));

  const productOptions = await db
    .select({
      id: schema.products.id,
      code: schema.products.code,
      designation: schema.products.designation,
      purchasePriceHt: schema.products.purchasePriceHt,
      defaultSalePriceHt: schema.products.defaultSalePriceHt,
    })
    .from(schema.products)
    .where(eq(schema.products.active, true))
    .orderBy(asc(schema.products.code));

  return (
    <div className="max-w-4xl">
      <Header
        backLabel="‹ Clients"
        backHref="/clients"
        title={c.name}
        subtitle={
          <span className="font-mono text-xs text-neutral-500">{c.code}</span>
        }
      />

      <div className="mt-6">
        <ClientForm
          mode="edit"
          initial={{
            code: c.code,
            name: c.name,
            legalName: c.legalName,
            siret: c.siret,
            vatNumber: c.vatNumber,
            iban: c.iban,
            billingAddress: c.billingAddress,
            billingCity: c.billingCity,
            billingZip: c.billingZip,
            shippingAddress: c.shippingAddress,
            shippingCity: c.shippingCity,
            shippingZip: c.shippingZip,
            geoZone: c.geoZone,
            categoryCode: c.categoryCode,
            defaultMarginPct: c.defaultMarginPct,
            paymentTerms: c.paymentTerms,
            contacts: c.contacts ?? [],
            active: c.active,
          }}
          categories={categories}
          action={updateClient.bind(null, c.id)}
        />
      </div>

      <div className="mt-6">
        <NegotiatedPrices
          clientId={c.id}
          rows={negotiatedPrices}
          productOptions={productOptions}
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
