import { clsx } from "clsx";
import s from "@/app/results/results.module.css";

// Page numbers to show: first, last, and a window around the current page, with gaps as null.
export function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) { keep.add(2); keep.add(3); }
  if (page >= pages - 2) { keep.add(pages - 1); keep.add(pages - 2); }
  const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

// Accessible pager: a nav landmark of real buttons (Tab, Enter and Space work), aria-current on the page shown.
export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className={s.pager} aria-label="Results pages">
      <button type="button" className={s.pill} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      {pageList(page, pages).map((n, i) =>
        n === null ? <span key={`gap${i}`} className={s.gap} aria-hidden="true">…</span> : (
          <button key={n} type="button" className={clsx(s.pill, n === page && s.on)} aria-current={n === page ? "page" : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>{n}</button>
        ))}
      <button type="button" className={s.pill} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}
