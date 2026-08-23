import { SetupRequired } from "./setup-required";
import { WorldConsole } from "@/components/world-console";

// Env check must run per-request, not at build time.
export const dynamic = "force-dynamic";

export default function Page() {
  const hasKey = !!process.env.REACTOR_API_KEY;
  return hasKey ? <WorldConsole /> : <SetupRequired />;
}
