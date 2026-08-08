import { NextResponse } from 'next/server';
import { ARCHITECTURE, SYSTEM_GRAPH, RIG_VISION, RIG_TIERS, FINAL_RECOMMENDATION, DEVICE_IDS } from '@/lib/studio/architecture';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    vision: RIG_VISION,
    devices: DEVICE_IDS.map((id) => ARCHITECTURE[id]),
    graph: SYSTEM_GRAPH,
    tiers: RIG_TIERS,
    recommendation: FINAL_RECOMMENDATION,
    deviceCount: DEVICE_IDS.length,
    edgeCount: SYSTEM_GRAPH.length,
  });
}
