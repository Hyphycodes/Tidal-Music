import { notFound } from "next/navigation";
import { getListDetail } from "@/lib/queries";
import { ListEditor } from "@/components/ListEditor";

export const dynamic = "force-dynamic";

export default async function ListPage({ params }: { params: { id: string } }) {
  const list = await getListDetail(params.id);
  if (!list) notFound();
  return <ListEditor initial={list} />;
}
