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
  bestTimeMs: number;
  latestTimeMs: number;
  completedQuestions: number;
  completed: boolean;
  lastResult: string;
  updatedAt: string;
};

const isPlayerId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);

const rank = (a: PlayerRecord, b: PlayerRecord) =>
  b.bestScore - a.bestScore ||
  Number(b.completed) - Number(a.completed) ||
  b.completedQuestions - a.completedQuestions ||
  a.bestTimeMs - b.bestTimeMs ||
  new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();

async function readRecord(url: string): Promise<PlayerRecord | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const value = await response.json();
    if (!value || !isPlayerId(value.playerId)) return null;
    return {
      ...value,
      bestTimeMs: Number.isFinite(value.bestTimeMs) ? value.bestTimeMs : 0,
      latestTimeMs: Number.isFinite(value.latestTimeMs) ? value.latestTimeMs : 0,
      completedQuestions: Number.isFinite(value.completedQuestions) ? value.completedQuestions : 0,
      completed: Boolean(value.completed),
    } as PlayerRecord;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const records: PlayerRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "players/", limit: 1000, cursor });
      const loaded = await Promise.all(page.blobs.map((blob) => readRecord(blob.url)));
      for (const record of loaded) if (record) records.push(record);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    records.sort(rank);
    const ranked = records.slice(0, 100);
    if (request.nextUrl.searchParams.get("format") === "txt") {
      const lines = [
        "KBC ARENA — GLOBAL LEADERBOARD",
        "Ranking: prize amount, completed questions, fastest completion time",
        "Generated: " + new Date().toISOString(),
        "",
        "RANK | PLAYER | BEST PRIZE | COMPLETED | TIME",
        "-----|--------|-----------|-----------|-----",
        ...ranked.map((r, index) => `${index + 1} | ${r.name.replace(/[|\\r\\n]/g, " ")} | ₹${r.bestScore.toLocaleString("en-IN")} | ${r.completedQuestions}/15 | ${r.bestTimeMs ? (r.bestTimeMs / 1000).toFixed(2) + "s" : "—"}`),
      ];
      return new NextResponse(lines.join("\n") + "\n", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": "attachment; filename=leaderboard.txt",
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ leaderboard: ranked }, {
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
    const timeMs = Number(body?.timeMs);
    const completedQuestions = Number(body?.completedQuestions);
    const completed = body?.completed === true;

    if (
      !isPlayerId(playerId) ||
      !name ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 10000000 ||
      !Number.isSafeInteger(timeMs) ||
      timeMs < 0 ||
      timeMs > 24 * 60 * 60 * 1000 ||
      !Number.isInteger(completedQuestions) ||
      completedQuestions < 0 ||
      completedQuestions > 15 ||
      (completed && completedQuestions !== 15)
    ) {
      return NextResponse.json({ error: "Invalid player score or timing data" }, { status: 400 });
    }

    const path = `players/${playerId}.txt`;
    const existingPage = await list({ prefix: path, limit: 1 });
    const existingBlob = existingPage.blobs.find((blob) => blob.pathname === path);
    const existing = existingBlob ? await readRecord(existingBlob.url) : null;

    const isBetter =
      !existing ||
      score > existing.bestScore ||
      (score === existing.bestScore &&
        (Number(completed) > Number(existing.completed) ||
          (completed === existing.completed &&
            (completedQuestions > existing.completedQuestions ||
              (completedQuestions === existing.completedQuestions &&
                (existing.bestTimeMs === 0 || timeMs < existing.bestTimeMs))))));

    const record: PlayerRecord = {
      playerId,
      name,
      gamesPlayed: (existing?.gamesPlayed ?? 0) + 1,
      bestScore: isBetter ? score : existing!.bestScore,
      latestScore: score,
      bestTimeMs: isBetter ? timeMs : existing!.bestTimeMs,
      latestTimeMs: timeMs,
      completedQuestions: isBetter ? completedQuestions : existing!.completedQuestions,
      completed: isBetter ? completed : existing!.completed,
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
