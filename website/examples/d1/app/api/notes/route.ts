import { desc } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { notes } from "../../../db/schema";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
type JsonObject = {
  [key: string]: JsonValue;
};
type NoteTextField = "content" | "title";

function isJsonObject<Value>(value: Value): value is Value & JsonObject {
  return value instanceof Object && !Array.isArray(value);
}

function readNoteText(payload: JsonValue, field: NoteTextField): string {
  if (payload === null) {
    throw new TypeError("Note payload must be an object.");
  }
  if (!isJsonObject(payload)) return "";
  const value = payload[field];
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (value !== text) {
    throw new TypeError(`Note ${field} must be text.`);
  }
  return text.trim();
}

function toRouteErrorMessage(error: Error) {
  const message = error.message;
  const detail =
    error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes('from "notes"')) {
    return "The notes table is unavailable. Generate the migration locally with `npm run db:generate`, then deploy so the platform can apply the generated SQL to the real D1 database.";
  }

  return message;
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(notes)
      .orderBy(desc(notes.createdAt), desc(notes.id))
      .limit(20);

    return Response.json({ notes: rows });
  } catch (error) {
    const routeError =
      error instanceof Error ? error : new Error("Unexpected error");
    return Response.json(
      { error: toRouteErrorMessage(routeError) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload: JsonValue = await request.json();
    const title = readNoteText(payload, "title");
    const content = readNoteText(payload, "content");

    if (!title) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }

    const db = getDb();
    const [note] = await db.insert(notes).values({ title, content }).returning();
    return Response.json({ note }, { status: 201 });
  } catch (error) {
    const routeError =
      error instanceof Error ? error : new Error("Unexpected error");
    return Response.json(
      { error: toRouteErrorMessage(routeError) },
      { status: 500 }
    );
  }
}
