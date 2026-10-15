"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Every page opens at the very top. Next.js scrolls only the changed layout segment into view, which leaves
// the top of a page under the sticky header. A link with a #hash still lands on its heading.
export function ScrollToTop() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}
