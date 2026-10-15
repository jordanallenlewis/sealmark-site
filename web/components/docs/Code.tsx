// The `pre` replacement for MDX: a small window bar with the language and a copy button (work package D1).
// Put code that does not exist yet inside <Planned>, which hides the copy button.
import { isValidElement } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { CopyButton } from "../CopyButton";
import s from "./DocsMdx.module.css";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function langOf(node: ReactNode): string {
  const kids = Array.isArray(node) ? node : [node];
  for (const k of kids) {
    if (isValidElement(k)) {
      const m = /language-([\w+-]+)/.exec(String((k.props as { className?: string }).className ?? ""));
      if (m) return m[1];
    }
  }
  return "";
}

export function Code(props: ComponentPropsWithoutRef<"pre">) {
  const text = textOf(props.children).replace(/\n$/, "");
  const lang = langOf(props.children);
  return (
    <div className={s.code}>
      <div className={s.codeBar}>
        <span className={s.lang}>{lang}</span>
        <CopyButton text={text} />
      </div>
      <pre {...props} tabIndex={0} />
    </div>
  );
}
