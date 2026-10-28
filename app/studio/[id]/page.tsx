import { Studio } from '@/components/studio/Studio';

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  return <Studio id={(await params).id} />;
}
