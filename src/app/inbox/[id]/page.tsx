import type { Metadata } from "next";
import { InboxApp } from "@/components/inbox/inbox-app";

export const metadata: Metadata = {
  title: "Inbox",
  robots: { index: false, follow: false },
};

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InboxApp endpointId={id} />;
}
