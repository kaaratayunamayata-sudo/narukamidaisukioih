import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const cors = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: cors });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply(503, { error: "サーバー環境変数が設定されていません。READMEを確認してください。" });
  }

  let body;
  try { body = await req.json(); } catch { return reply(400, { error: "Invalid JSON" }); }
  const supplied = String(body.password || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return reply(401, { error: "パスワードが違います" });

  if (body.action === "login") return reply(200, { ok: true });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  if (body.action === "race" && body.race) {
    const { error } = await supabase.from("race_state").upsert({ id: 1, state: body.race, updated_at: new Date().toISOString() });
    if (error) return reply(500, { error: error.message });
    return reply(200, { ok: true });
  }
  if (body.action === "reset") {
    const { error } = await supabase.from("race_state").upsert({ id: 1, state: { running: false, paused: false, winner: null }, updated_at: new Date().toISOString() });
    if (error) return reply(500, { error: error.message });
    return reply(200, { ok: true });
  }
  return reply(400, { error: "Unknown action" });
};
