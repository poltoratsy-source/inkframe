import { ReplayView } from '@/components/replay/ReplayView';

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReplayView id={(await params).id} />;
}
