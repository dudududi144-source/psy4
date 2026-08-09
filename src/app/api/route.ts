export const runtime = 'edge';

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", project: "PSY4" });
}
