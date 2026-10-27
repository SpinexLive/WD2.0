import type { Metadata } from "next";
import ObserveClient from "./ObserveClient";

export const metadata: Metadata = { title: "Observations | REMNANT" };

export default function ObservePage() {
  return <ObserveClient />;
}
