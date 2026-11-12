"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// One small POST per page view to /api/visit (worker/visits.mjs): the path, and on the first page of a visit the
// referring page and the UTM params. No cookie, no stored id, nothing read from or written to the device, so pages
// cannot be joined into a person. Skipped when the browser asks not to be tracked (Global Privacy Control or Do Not
// Track) and for automated browsers. What is kept: /privacy/.
let landed = false;

export function VisitBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.webdriver === true) return;
      const landing = !landed;
      landed = true;
      const q = new URLSearchParams(location.search);
      const body = JSON.stringify({
        path: pathname || location.pathname,
        landing,
        ...(landing
          ? { referrer: document.referrer, utm_source: q.get("utm_source") ?? "", utm_medium: q.get("utm_medium") ?? "", utm_campaign: q.get("utm_campaign") ?? "" }
          : {}),
      });
      // text/plain keeps the beacon a simple request; the Worker parses the JSON itself.
      if (!navigator.sendBeacon?.("/api/visit", new Blob([body], { type: "text/plain" }))) {
        fetch("/api/visit", { method: "POST", body, keepalive: true }).catch(() => {});
      }
    } catch {
      // counting a visit must never break the page
    }
  }, [pathname]);
  return null;
}
