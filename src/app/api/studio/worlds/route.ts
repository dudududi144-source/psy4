import { NextResponse } from 'next/server';
import { WORLD_LIST, WORLDS } from '@/lib/studio/engine/worlds';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ worlds: WORLD_LIST, count: WORLD_LIST.length });
}
