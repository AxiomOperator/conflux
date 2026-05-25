import { WikiSpaceView } from "@/components/wiki-space-view";

export default async function WikiPageView({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  return <WikiSpaceView pageId={pageId} />;
}
