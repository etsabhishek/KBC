import { list, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerRecord = {
  playerId: string;
  name: string;
  gamesPlayed: number;
  bestScore: number;
  latestScore: number;
  lastResult: string;
  updatedAt: string;
};

const isPlayerId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

async function readRecord(url: string): Promise<PlayerRecord | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const value = await response.json();
    if (!value || !isPlayerId(value.playerId)) return null;
    return value as PlayerRecord;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const records: PlayerRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "players/", limit: 1000, cursor });
      const loaded = await Promise.all(page.blobs.map((blob) => readRecord(blob.url)));
      for (const record of loaded) if (record) records.push(record);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    records.sort((a, b) => b.bestScore - a.bestScore || a.name.localeCompare(b.name));
    return NextResponse.json({ leaderboard: records.slice(0, 100) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Leaderboard read failed", error);
    return NextResponse.json({ error: "Unable to load leaderboard" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const playerId = body?.playerId;
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 24) : "";
    const score = Number(body?.score);
    const result = typeof body?.result === "string" ? body.result.slice(0, 20) : "completed";

    if (!isPlayerId(playerId) || !name || !Number.isFinite(score) || score < 0 || score > 10000000) {
      return NextResponse.json({ error: "Invalid player score" }, { status: 400 });
    }

    const path = `players/${playerId}.txt`;
    const existingPage = await list({ prefix: path, limit: 1 });
    const existingBlob = existingPage.blobs.find((blob) => blob.pathname === path);
    const existing = existingBlob ? await readRecord(existingBlob.url) : null;

    const record: PlayerRecord = {
      playerId,
      name,
      gamesPlayed: (existing?.gamesPlayed ?? 0) + 1,
      bestScore: Math.max(existing?.bestScore ?? 0, score),
      latestScore: score,
      lastResult: result,
      updatedAt: new Date().toISOString(),
    };

    await put(path, JSON.stringify(record, null, 2) + "\n", {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "text/plain; charset=utf-8",
      cacheControlMaxAge: 60,
    });

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    console.error("Leaderboard write failed", error);
    return NextResponse.json({ error: "Unable to save player score" }, { status: 500 });
  }
}
