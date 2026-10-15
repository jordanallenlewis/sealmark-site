import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/docs/Callout";
import { Code } from "@/components/docs/Code";
import { Figure, Table } from "@/components/docs/MdxBits";
import { Planned } from "@/components/docs/Planned";
import { Status } from "@/components/docs/Status";
import { Tab, Tabs } from "@/components/docs/Tabs";
import { GradeLadder } from "@/components/visuals/GradeLadder";
import { Mechanism } from "@/components/visuals/Mechanism";
import { Pipeline } from "@/components/visuals/Pipeline";
import { RoleLanes } from "@/components/visuals/RoleLanes";

// Components every .mdx page can use without importing them (frozen docs contract, plan section 7.5):
// Status, Tabs/Tab, Callout kind="warn|note", Figure (wraps a visuals/* figure at rest), Planned (ribbon around a block).
// Status, Tabs, Callout, Planned and Code (the `pre` wrapper with a copy button) come from components/docs (D1).
// Figure and Table (GFM tables scroll inside their own box) are the D2 helpers in components/docs/MdxBits.
// The visuals are registered by bare name so a page can write <Figure><Mechanism /></Figure>.
const components: MDXComponents = {
  Status,
  Tabs,
  Tab,
  Callout,
  Figure,
  Planned,
  pre: Code,
  table: Table,
  Mechanism,
  Pipeline,
  RoleLanes,
  GradeLadder,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
