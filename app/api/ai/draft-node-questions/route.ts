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

// ~150 tokens of questions is plenty; this cap is what makes call 1 cost
// roughly a fiftieth of a cent.
const MAX_OUTPUT_TOKENS = 300;

const QUESTIONS_PROMPT =
  "The user is writing a short personal note about one part of their life, " +
  "under the heading they give you. Ask 3 to 5 short questions whose answers " +
  "would let someone write that note in the user's own voice. " +
  "Make every question specific to this heading — never generic filler like " +
  '"what are your responsibilities" or "what are your goals". ' +
  "Ask about concrete particulars only the user would know: names, routines, " +
  "specific decisions, what is actually hard about it. " +
  // A name is not a gender. Live testing with the heading "My manager
  // Dana" had the model write "her" and "she" throughout, inventing a
  // fact about a real person the user never supplied — the same class of
  // error as making up a job title, and more likely to be noticed and
  // resented. These notes get pasted into other AI tools as fact.
  "Never assume or infer anyone's gender or pronouns from their name. Unless " +
  "the user has stated them, write about people using they/them, or rephrase " +
  "to avoid pronouns entirely. " +
  "You may append a short example answer in parentheses to show the kind of " +
  "detail wanted. " +
  "Output one question per line, with no numbering, no bullets, no preamble " +
  "and no closing remark.";

/**
 * Parses the model's reply as plain lines rather than enforcing a JSON
 * schema. A flat array of short strings gains nothing from a schema, costs
 * output tokens on braces and keys, and would add a nano-compatibility
 * unknown. Strips any numbering or bullet the model adds anyway.
 */
export function parseQuestions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
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
