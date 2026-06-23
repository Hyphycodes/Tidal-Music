import { Suspense } from "react";
import { ObservationCard } from "@/components/ObservationCard";
import { LibraryScreen } from "@/components/LibraryScreen";

// Library is home. force-dynamic because the screen reads URL filter state.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <ObservationCard />
      <Suspense fallback={null}>
        <LibraryScreen />
      </Suspense>
    </div>
  );
}
