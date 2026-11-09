import { Seal } from "@/components/Seal";
import type { Run } from "@/lib/history";
import s from "@/app/results/results.module.css";

// Grade over time for one server: one seal per fleet run, oldest first, with the date, the version tested and the Sealmark
// version where one was recorded. A failed run (the server did not start) shows a dash, not a grade.
export function GradeHistory({ runs, label }: { runs: Run[]; label: string }) {
  return (
    <ol className={s.hist} aria-label={`Grade history for ${label}`}>
      {runs.map((r) => (
        <li key={r.date} className={s.histRun}>
          {r.status === "ok" && r.worst ? <Seal g={r.worst} /> : <span className={s.histFail} role="img" aria-label="Test failed to run">–</span>}
          <time dateTime={r.date}>{r.date}</time>
          <small>{r.status === "ok" ? `v${r.version}` : "did not run"}</small>
          {r.sealmark && <small>Sealmark {r.sealmark}</small>}
        </li>
      ))}
    </ol>
  );
}
