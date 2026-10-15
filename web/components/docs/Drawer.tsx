"use client";
// Below 900px the sidebar moves into a modal <dialog> opened by a "Docs menu" button (work package D1).
// Esc closes it (native), so does a click on the backdrop, on a link, a route change, or growing the window past 900px.
// Nothing here depends on the dialog's "close" event, which did not fire in Chrome 154: the open state mirrors the
// dialog's own `open` attribute (MutationObserver), and the scroll lock is CSS (body:has(dialog[open]) in globals.css).
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import s from "@/app/docs/docs.module.css";

export function Drawer({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current?.open) ref.current.close();
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) ref.current?.close();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const sync = () => setOpen(d.open);
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(d, { attributes: true, attributeFilter: ["open"] });
    d.addEventListener("close", sync);
    return () => {
      mo.disconnect();
      d.removeEventListener("close", sync);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={s.menuBtn}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
      >
        Docs menu
      </button>
      <dialog
        ref={ref}
        className={s.drawer}
        aria-label="Docs menu"
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t === ref.current || t.closest("a")) ref.current?.close();
        }}
      >
        <div className={s.drawerHead}>
          {badge}
          <button type="button" className={s.drawerClose} onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
