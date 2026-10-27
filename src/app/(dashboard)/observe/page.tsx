import type { Metadata } from "next";
import ObserveClient from "./ObserveClient";

export const metadata: Metadata = { title: "Match Feedback | REMNANT" };

export default function ObservePage() {
  return <ObserveClient />;
}
