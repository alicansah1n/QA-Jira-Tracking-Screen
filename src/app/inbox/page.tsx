import type { Metadata } from "next";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Gelen Kutusu" };

export default function InboxPage() {
  return <InboxView />;
}
