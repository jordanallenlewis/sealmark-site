import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocHeader } from "@/components/docs/MdxBits";
import { listDocs, loadDoc } from "../content";

// Every content/docs/**/*.mdx file becomes /docs/<path>/ at build time. Nothing is rendered on request.
export const dynamicParams = false;

type Props = { params: Promise<{ slug?: string[] }> };

export function generateStaticParams() {
  return listDocs().map((d) => ({ slug: d.slug }));
}

const find = (slug: string[] = []) => listDocs().find((d) => d.slug.join("/") === slug.join("/"));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = find((await params).slug);
  if (!doc) return {};
  const { meta } = await loadDoc(doc.file);
  if (!meta) return {};
  return { title: `${meta.title} | Sealmark docs`, description: meta.description };
}

export default async function DocPage({ params }: Props) {
  const doc = find((await params).slug);
  if (!doc) notFound();
  const { default: Content, meta } = await loadDoc(doc.file);
  if (!meta) throw new Error(`content/docs/${doc.file}.mdx must export const meta = { title, since, status }`);
  return (
    <article>
      <DocHeader title={meta.title} description={meta.description} status={meta.status} />
      <Content />
    </article>
  );
}
