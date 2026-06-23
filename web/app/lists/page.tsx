import { getLists } from "@/lib/queries";
import { ListsIndex } from "@/components/ListsIndex";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const lists = await getLists();
  return <ListsIndex initial={lists} />;
}
