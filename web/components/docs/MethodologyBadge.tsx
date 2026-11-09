import { clsx } from "clsx";
// Persistent "methodology <version>" badge, read from content/generated/meta.json (work package D1).
import Link from "next/link";
import meta from "@/content/generated/meta.json";
import s from "@/app/docs/docs.module.css";

export function MethodologyBadge({ className = "" }: { className?: string }) {
  return (
    <Link href="/docs/methodology/" prefetch={false} className={clsx(s.badge, className)} title="The published rules these grades follow">
      <span aria-hidden="true">&#9679;</span> methodology {meta.methodology}
    </Link>
  );
}
