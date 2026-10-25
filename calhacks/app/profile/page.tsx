import PageHeader from "@/components/PageHeader";
import Appearance from "@/components/profile/Appearance";

export default function ProfilePage() {
  return (
    <div>
      <PageHeader title="Profile" description="How this dashboard looks for the restaurant." />
      <Appearance />
    </div>
  );
}
