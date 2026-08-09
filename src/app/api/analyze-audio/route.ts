import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CED_CLI = '/tmp/ced.cpp/build/examples/cli/ced-cli';
const CED_MODEL = '/tmp/ced.cpp/models/ced-base-q8_0.gguf';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File;
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Save to temp file
    const bytes = await file.arrayBuffer();
    const tempPath = join(tmpdir(), `psy4_capture_${Date.now()}.wav`);
    await writeFile(tempPath, Buffer.from(bytes));

    // Run ced.cpp analysis
    let tags: { score: number; tag: string }[] = [];
    let dsp: Record<string, number> = {};

    try {
      const result = execSync(`${CED_CLI} ${CED_MODEL} ${tempPath}`, {
        timeout: 30000,
        encoding: 'utf-8',
      });

      // Parse ced output
      const lines = result.trim().split('\n');
      for (const line of lines.slice(1)) { // skip first line (filename)
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          tags.push({ score: parseFloat(parts[0]), tag: parts.slice(1).join(' ') });
        }
      }
    } catch (e) {
      console.error('ced.cpp failed:', e);
    }

    // DSP analysis using Python
    try {
      const pyScript = `
import numpy as np, wave, json, sys
w = wave.open('${tempPath}', 'r')
data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
sr = w.getframerate()
w.close()
n = len(data)
peak = float(np.max(np.abs(data)))
rms = float(np.sqrt(np.mean(data**2)))
lufs = float(20 * np.log10(rms + 1e-9) - 0.691)
crest = float(peak / (rms + 1e-9))
fft_size = min(8192, n)
windowed = data[:fft_size] * np.hanning(fft_size)
spectrum = np.abs(np.fft.rfft(windowed))
freqs = np.fft.rfftfreq(fft_size, 1/sr)
centroid = float(np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-9))
def band(lo, hi):
    mask = (freqs >= lo) & (freqs < hi)
    return float(np.sum(spectrum[mask]**2))
sub = band(20, 60)
low = band(60, 200)
mid = band(200, 3000)
high = band(3000, 20000)
total = sub + low + mid + high + 1e-9
print(json.dumps({
    'duration': n / sr, 'peak': peak, 'rms': rms, 'lufs': lufs,
    'crest_factor': crest, 'centroid': centroid,
    'sub_energy': sub/total*100, 'low_energy': low/total*100,
    'mid_energy': mid/total*100, 'high_energy': high/total*100
}))
`;
      const pyResult = execSync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, {
        timeout: 10000,
        encoding: 'utf-8',
      });
      dsp = JSON.parse(pyResult.trim());
    } catch (e) {
      console.error('DSP analysis failed:', e);
    }

    // Cleanup
    try { await unlink(tempPath); } catch { /* noop */ }

    return NextResponse.json({
      tags: tags.slice(0, 10),
      dsp,
      duration: dsp.duration || 0,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
