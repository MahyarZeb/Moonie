import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { normalizeCode } from '@shared/roomCode';
import { RoomShell } from '@/components/room/RoomShell';

export const metadata: Metadata = {
  title: 'Moonie 🌙 | Room',
  robots: { index: false },
};

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const code = normalizeCode(decoded);
  if (!code) notFound();
  return <RoomShell code={code} />;
}
