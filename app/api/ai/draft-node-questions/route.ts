import { NextResponse } from "next/server";
import {
  authorizeAiRequest,
  reserveAndCheckCaps,
  refundAndMapError,
  settleQuietly,
} from "@/lib/llm/guard";
import { callOpenAI, inputTokenBound } from "@/lib/llm/openai";

// `ai-node-drafting`, call 1 of 2: given only a node's heading, ask the
// user a few questions whose answers would let call 2 write the body.
//
// The client sends a title and an optional domain. It does NOT send the
// graph, the node body, or anything resembling a prompt — the instructions
// below are the whole prompt and they are fixed here, which is what keeps
// SPEC.md's "fixed task endpoints only" boundary true.
const TASK = "draft-node-questions";

// A heading, not a document. Generous enough for a long title, small
// enough that this call can never be an expensive one.
const MAX_TITLE_CHARS = 200;
const MAX_DOMAIN_CHARS = 60;

// Raised from 300 when questions gained options: the JSON wrapper and the
// choices themselves need the room. Still a fraction of a cent per call.
const MAX_OUTPUT_TOKENS = 700;

const MAX_OPTIONS_PER_QUESTION = 5;

// Format first, deliberately. An earlier version explained the questions
// and mentioned the JSON shape last; the model then wrote a question whose
// TEXT read 'options: "go for progress," "chill and send,"' instead of
// filling the options array. It had understood the intent and lost the
// shape. Leading with a worked example of both question kinds fixed it.
const QUESTIONS_PROMPT =
  "Reply with JSON and nothing else. No markdown fence, no preamble, no " +
  "closing remark. Exactly this shape:\n" +
  '{"questions":[\n' +
  '  {"text":"Where do you usually climb?"},\n' +
  '  {"text":"How often do you go?","options":["Most weekends","Monthly","A few times a year"]}\n' +
  "]}\n" +
  "The first kind is a free-text question. The second offers taps. NEVER " +
  "write the choices inside the question text — they go in the options " +
  "array or nowhere.\n\n" +
  "The user is writing a short personal note about one part of their life, " +
  "under the heading they give you. Ask 3 to 5 short questions whose " +
  "answers would let someone write that note in the user's own voice. " +
  "Make every question specific to this heading — never generic filler " +
  'like "what are your responsibilities" or "what are your goals". ' +
  "Ask about concrete particulars only the user would know: names, " +
  "routines, specific decisions, what is actually hard about it. " +
  // A name is not a gender. Live testing with the heading "My manager
  // Dana" had the model write "her" and "she" throughout, inventing a
  // fact about a real person the user never supplied — the same class of
  // error as making up a job title, and more likely to be noticed and
  // resented. These notes get pasted into other AI tools as fact.
  "Never assume or infer anyone's gender or pronouns from their name. " +
  "Unless the user has stated them, write about people using they/them, " +
  "or rephrase to avoid pronouns entirely. " +
  // Typing five free-text answers is what makes this feature tiring in
  // practice. Options turn the categorical questions into a tap. But they
  // must not become the default: a question answerable from a list of
  // guesses returns the bucket the user is in rather than what is true
  // about them, which is the generic output this feature exists to avoid.
  "Give options when a question has a small set of genuinely likely " +
  "answers that would cover most people — frequency, difficulty, mood, " +
  "style, how long something has been going on. Give NO options for " +
  "anything asking about a specific name, place, person or event: a " +
  "guessed list there is worse than an empty box. Aim for a mix. " +
  "Keep each option under about six words, and give 3 to 5 of them. " +
  "For a free-text question you may append a short example answer in " +
  "parentheses to show the kind of detail wanted."

export interface DraftQuestion {
  text: string;
  /** Absent means free text. Never an empty array. */
  options?: string[];
}

/**
 * Parses the model's reply.
 *
 * JSON now, where plain lines were enough before. The shape stopped being a
 * flat list of strings the moment questions could carry options, and a
 * delimiter format would have collided with the bullet-stripping this
 * parser already needed (models add bullets whatever the prompt says).
 *
 * Tolerant on the way in, strict on the way out: a fenced block, a bare
 * array, or a wrapped object all parse, and anything malformed yields
 * nothing rather than a half-built question. The caller treats fewer than
 * two questions as an unusable reply.
 */
export function parseQuestions(text: string): DraftQuestion[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const raw = Array.isArray(parsed)
    ? parsed
    : (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(raw)) return [];

  const out: DraftQuestion[] = [];
  for (const item of raw) {
    // A bare string is still accepted: it is the cheapest possible
    // degradation if the model forgets the object shape, and a free-text
    // question is a perfectly good question.
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ text: t });
      continue;
    }
    const { text: qText, options } = (item ?? {}) as { text?: unknown; options?: unknown };
    if (typeof qText !== "string" || qText.trim().length === 0) continue;

    const cleanOptions = Array.isArray(options)
      ? Array.from(
          new Set(
            options
              .filter((o): o is string => typeof o === "string")
              .map((o) => o.trim())
              .filter(Boolean)
          )
        ).slice(0, MAX_OPTIONS_PER_QUESTION)
      : [];

    // A single option is not a choice, it is a leading question. Drop back
    // to free text rather than presenting one chip and an Other box.
    out.push(
      cleanOptions.length >= 2
        ? { text: qText.trim(), options: cleanOptions }
        : { text: qText.trim() }
    );
    if (out.length === 5) break;
  }
  return out;
}

export async function POST(request: Request) {
  const auth = await authorizeAiRequest();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { title, domain } = (body ?? {}) as { title?: unknown; domain?: unknown };
  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Give the node a title first." }, { status: 400 });
  }
  if (title.length > MAX_TITLE_CHARS) {
    return NextResponse.json({ error: "That title is too long." }, { status: 400 });
  }
  if (domain !== undefined && (typeof domain !== "string" || domain.length > MAX_DOMAIN_CHARS)) {
    return NextResponse.json({ error: "That domain tag is too long." }, { status: 400 });
  }

  const input = domain?.trim()
    ? `Heading: ${title.trim()}\nPart of life: ${domain.trim()}`
    : `Heading: ${title.trim()}`;

  const reservation = await reserveAndCheckCaps({
    userId: auth.userId,
    task: TASK,
    estimatedInputTokens: inputTokenBound(input),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!reservation.ok) return reservation.response;

  let result;
  try {
    result = await callOpenAI({
      instructions: QUESTIONS_PROMPT,
      input,
      userId: auth.userId,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    return refundAndMapError(reservation.reservationId, err);
  }

  const questions = parseQuestions(result.text);
  if (questions.length < 2) {
    // The call happened and is billed, so settle it honestly rather than
    // refunding — but there is nothing usable to return.
    await settleQuietly(reservation.reservationId, result);
    console.error(
      `${TASK}: model returned ${questions.length} usable question(s); expected 3-5. ` +
        "Check the prompt or the model's line formatting."
    );
    return NextResponse.json(
      { error: "The AI service returned an unexpected response." },
      { status: 502 }
    );
  }

  await settleQuietly(reservation.reservationId, result);
  return NextResponse.json({ questions });
}
