import { ChangelogPage } from "@/components/changelog-page";
import { CHANGELOG } from "@/lib/changelog";

export default function ChangelogRoute() {
  return <ChangelogPage releases={CHANGELOG} />;
}
