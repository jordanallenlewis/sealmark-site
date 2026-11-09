"use client";
import dynamic from "next/dynamic";

// The route-change progress bar: nextjs-toploader, the same package and pin as steambangers.com and jordanallenlewis.com.
// Code-split (ssr:false, only valid in a client component) so it never adds to a page's first-load JS; it appears on the
// first client navigation. The library writes these values into a <style>, so the site's --accent token resolves there.
const NextTopLoader = dynamic(() => import("nextjs-toploader"), { ssr: false });

export function TopLoader() {
  return <NextTopLoader color="var(--accent)" height={2} showSpinner={false} shadow="0 0 8px var(--accent)" speed={300} crawlSpeed={160} />;
}
