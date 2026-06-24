import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { requireEnv, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL, ELEVENLABS_SPEED } from "./config.ts";

/**
 * ElevenLabs text-to-speech for the DJ commentary. One concern per module (like lastfm.ts): turn a
 * line of Stephen Holloway's script into an MP3. Synthesis is cached by a hash of text+voice+model,
 * so re-running a show doesn't re-spend API calls on unchanged segments.
 */

const API = "https://api.elevenlabs.io/v1/text-to-speech";
const OUTPUT_FORMAT = "mp3_44100_128"; // 44.1kHz/128kbps MP3 — Roon-friendly

/** Stable cache key (and clip filename stem) for a piece of narration. */
export function clipHash(text: string, voiceId: string, modelId: string, speed: number): string {
  return createHash("sha1").update(`${voiceId}|${modelId}|${speed}|${text}`).digest("hex").slice(0, 16);
}

export interface SynthOptions {
  voiceId?: string;
  modelId?: string;
  speed?: number;
}

/**
 * Synthesize `text` to `outPath` (an MP3). No-op if the file already exists (cache hit). Returns
 * whether it hit the cache, so callers can report API usage. Throws a helpful error on non-2xx.
 */
export async function synthesize(
  text: string,
  outPath: string,
  opts: SynthOptions = {},
): Promise<{ cached: boolean }> {
  // Cache: identical text+voice+model already rendered.
  try {
    await access(outPath);
    return { cached: true };
  } catch {
    // not cached — fall through to synthesize
  }

  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = opts.voiceId ?? ELEVENLABS_VOICE_ID;
  const modelId = opts.modelId ?? ELEVENLABS_MODEL;
  const speed = opts.speed ?? ELEVENLABS_SPEED;

  const res = await fetch(`${API}/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, audio);
  return { cached: false };
}
