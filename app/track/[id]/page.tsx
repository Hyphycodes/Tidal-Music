import { notFound } from "next/navigation";
import { getTrackDetail } from "@/lib/queries";
import { DetailView } from "@/components/DetailView";

// Server-rendered from a single query → opens instantly (prefetched on hover).
export const revalidate = 300;

export default async function TrackPage({ params }: { params: { id: string } }) {
  const track = await getTrackDetail(params.id);
  if (!track) notFound();
  return <DetailView kind="track" track={track} />;
}
