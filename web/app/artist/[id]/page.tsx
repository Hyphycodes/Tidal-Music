import { notFound } from "next/navigation";
import { getArtistDetail } from "@/lib/queries";
import { DetailView } from "@/components/DetailView";

export const revalidate = 300;

export default async function ArtistPage({ params }: { params: { id: string } }) {
  const artist = await getArtistDetail(params.id);
  if (!artist) notFound();
  return <DetailView kind="artist" artist={artist} />;
}
