import { Suspense } from "react";
import { DashboardPage } from "@/components/dashboard-page";

export default function DashboardRoute() {
  return (
    <Suspense fallback={<div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading endpoints…</div>}>
      <DashboardPage />
    </Suspense>
  );
}
