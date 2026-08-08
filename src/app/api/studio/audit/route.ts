import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

/** Return the latest audit report (JSON or Markdown). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const format = url.searchParams.get('format') || 'json';
  const reportDir = path.join(process.cwd(), 'audit-reports');
  const file = format === 'md' ? 'audit-latest.md' : 'audit-latest.json';
  const fp = path.join(reportDir, file);
  if (!fs.existsSync(fp)) {
    return NextResponse.json({ error: 'No audit report found. Run the independent proof runner first: bun run scripts/independent-proof.ts' }, { status: 404 });
  }
  const content = fs.readFileSync(fp, 'utf-8');
  if (format === 'md') {
    return new Response(content, { headers: { 'Content-Type': 'text/markdown' } });
  }
  return NextResponse.json(JSON.parse(content));
}
