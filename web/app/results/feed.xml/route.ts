import { allChangesFeed, atomResponse } from "@/lib/feed-data";

export const dynamic = "force-static";
// Atom feed of grade changes across every graded server (site#59, lib/feed.mjs has the rule for what is listed).
export function GET() { return atomResponse(allChangesFeed()); }
