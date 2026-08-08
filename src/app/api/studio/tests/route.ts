import { NextResponse } from 'next/server';
import { runAllTests } from '@/lib/studio/tests';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  try {
    const { results, summary } = await runAllTests();
    return NextResponse.json({ results, summary, timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, results: [], summary: { total: 0, pass: 0, fail: 0, blocked: 0, notImplemented: 0, totalMs: 0 } }, { status: 500 });
  }
}

export async function GET() {
  // return the test catalog (without running)
  const { ALL_TESTS } = await import('@/lib/studio/tests');
  return NextResponse.json({ tests: ALL_TESTS.map((t) => ({ id: t.id, name: t.name })), count: ALL_TESTS.length });
}
