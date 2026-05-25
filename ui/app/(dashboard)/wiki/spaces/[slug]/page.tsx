import { WikiSpaceView } from "@/components/wiki-space-view";

export default async function WikiSpacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <WikiSpaceView spaceSlug={decodeURIComponent(slug)} />;
}
