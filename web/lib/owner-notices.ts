// What each server page says about its public owner issue, from fleet/owner-status.json (written by the fleet's re-test
// run, fleet/owner-status.mjs). Read at build time; a missing or unreadable file shows nothing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ownerNotice } from "@/lib/owner-notice.mjs";

type Entry = Parameters<typeof ownerNotice>[0];
let all: Record<string, NonNullable<Entry>> | undefined;
export function ownerNoticeFor(id: string) {
  if (!all) {
    try { all = (JSON.parse(readFileSync(resolve(process.cwd(), "..", "fleet", "owner-status.json"), "utf8")) as { notices?: Record<string, NonNullable<Entry>> }).notices ?? {}; }
    catch { all = {}; }
  }
  return Object.prototype.hasOwnProperty.call(all, id) ? ownerNotice(all[id]) : null;
}
