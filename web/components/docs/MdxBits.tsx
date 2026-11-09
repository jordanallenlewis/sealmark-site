import { clsx } from "clsx";
// Fallback MDX building blocks owned by work package D2: Status, Callout, Planned, Figure and the `pre` wrapper.
// Tabs live in MdxTabs.tsx because they need client state. If D1 ships its own Status/Tabs/Code in this folder,
// switch the imports in web/mdx-components.tsx and delete what is no longer used.
import { Children, cloneElement, isValidElement } from "react";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { CopyButton } from "../CopyButton";
import s from "./MdxBits.module.css";

export type StatusKind = "shipped" | "planned" | "opt-in" | "advisory" | "critical";

const STATUS: Record<StatusKind, { cls: string; extra?: string }> = {
  shipped: { cls: "c-pass" },
  planned: { cls: "", extra: s.statusPlanned },
  "opt-in": { cls: "c-inconclusive", extra: s.statusOpt },
  advisory: { cls: "c-na", extra: s.statusAdv },
  critical: { cls: "c-fail" },
};

/** A small status pill. `planned` is dashed and says the word, so it never reads as shipped. */
export function Status({ kind, children }: { kind: StatusKind; children?: ReactNode }) {
  const m = STATUS[kind] ?? STATUS.shipped;
  return <span className={clsx("chip", m.cls, m.extra, s.status)}>{children ?? kind}</span>;
}

export function Callout({ kind = "note", title, children }: { kind?: "note" | "warn"; title?: string; children: ReactNode }) {
  return (
    <aside className={clsx(s.callout, kind === "warn" && s.calloutWarn)} role="note">
      <span className={s.calloutTitle}>{title ?? (kind === "warn" ? "Warning" : "Note")}</span>
      {children}
    </aside>
  );
}

/** Wraps a block that describes something designed but not built. No copy button inside. */
export function Planned({ children, label = "planned, not available" }: { children: ReactNode; label?: string }) {
  return (
    <div className={s.planned} role="group" aria-label="Planned, not built">
      <span className={s.plannedRibbon}>{label}</span>
      {children}
    </div>
  );
}

/** Wraps a `visuals/*` figure and renders it at rest (`auto={false}`) unless the author set `auto` themselves. */
export function Figure({ children }: { children: ReactNode }) {
  const kids = Children.map(children, (c) => {
    if (isValidElement(c) && typeof c.type !== "string" && (c.props as { auto?: boolean }).auto === undefined) {
      return cloneElement(c as ReactElement<{ auto?: boolean }>, { auto: false });
    }
    return c;
  });
  return <div className={s.figure}>{kids}</div>;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Every fenced code block gets a copy button. Blocks inside <Planned> hide it (see MdxBits.module.css). */
export function Pre(props: ComponentPropsWithoutRef<"pre">) {
  const text = textOf(props.children).replace(/\n$/, "");
  return (
    <div className={s.codeWrap}>
      <pre {...props} tabIndex={0} />
      <CopyButton text={text} />
    </div>
  );
}

/** GFM tables scroll inside their own box so the page never scrolls sideways. */
export function Table(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div className={clsx("tw", s.tableWrap)} tabIndex={0} role="region" aria-label="Table">
      <table {...props} className={s.mdxTable} />
    </div>
  );
}

/** Title block for a docs page: h1, one-line description, status pill, and the planned banner. */
export function DocHeader({ title, description, status }: { title: string; description?: string; status: "shipped" | "planned" | "opt-in" }) {
  return (
    <header className={s.docHeader}>
      <h1>{title}</h1>
      {description ? <p className={s.lede}>{description}</p> : null}
      <div className={s.docMeta}>
        <Status kind={status} />
      </div>
      {status === "planned" ? (
        <Callout kind="warn" title="Planned">
          Designed, not built. Nothing on this page runs today.
        </Callout>
      ) : null}
    </header>
  );
}

export { s as mdxStyles };
