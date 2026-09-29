import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../lib/auth-context";
import NccpPlatform from "../components/nccp/NccpPlatform";
import { DashboardLayout } from "../components/dashboard-layout";
import { MobileAttendanceCheckIn } from "../components/nccp/MobileAttendanceCheckIn";

function MainApp() {
  const { isAuthenticated } = useAuth();
  const [isAttendanceScan, setIsAttendanceScan] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      if (search.get("action") === "attendance" || search.has("scan")) {
        setIsAttendanceScan(true);
      }
    }
  }, []);

  if (isAttendanceScan) {
    return (
      <MobileAttendanceCheckIn
        onBackToPlatform={() => {
          setIsAttendanceScan(false);
          const url = new URL(window.location.href);
          url.searchParams.delete("action");
          url.searchParams.delete("scan");
          url.searchParams.delete("token");
          url.searchParams.delete("batch");
          url.searchParams.delete("course");
          url.searchParams.delete("trainer");
          url.searchParams.delete("date");
          window.history.pushState({}, "", url.pathname + (url.search ? url.search : ""));
        }}
      />
    );
  }

  // If authenticated, show the authenticated workspace with floating profile switcher.
  // Otherwise render the full public NCCP Platform (Landing page, Sign-In, Role previews).
  return isAuthenticated ? <DashboardLayout /> : <NccpPlatform />;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NCCP | National Cooperative Capacity Building Platform" },
      { name: "description", content: "A unified training-to-employment ecosystem for India’s cooperative sector." },
      { property: "og:title", content: "NCCP | National Cooperative Capacity Building Platform" },
      { property: "og:description", content: "From skills to opportunities, for a stronger Bharat." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: MainApp,
});

