import { db } from "./db";
import type { ExpressionInput } from "./pipeline";

// Built-in expression library: prompt fragments applied at generation time
// (2D layer — see DESIGN.md §2). Users add their own, optionally with a
// reference image, via the Expressions panel; those live in db.expressions.

export interface BuiltinExpression {
  id: string;
  name: string;
  promptFragment: string;
}

export const BUILTIN_EXPRESSIONS: BuiltinExpression[] = [
  { id: "x-neutral", name: "Neutral", promptFragment: "a calm, neutral facial expression" },
  { id: "x-happy", name: "Happy", promptFragment: "a warm, happy smile" },
  { id: "x-laugh", name: "Laughing", promptFragment: "laughing openly, eyes crinkled with joy" },
  { id: "x-sad", name: "Sad", promptFragment: "a sad, downcast expression" },
  { id: "x-cry", name: "Crying", promptFragment: "crying, tears on the cheeks" },
  { id: "x-angry", name: "Angry", promptFragment: "an angry scowl, furrowed brows" },
  { id: "x-rage", name: "Furious", promptFragment: "furious, gritted teeth, intense glare" },
  { id: "x-surprise", name: "Surprised", promptFragment: "wide-eyed surprise, mouth slightly open" },
  { id: "x-shock", name: "Shocked", promptFragment: "shocked, jaw dropped, eyes wide" },
  { id: "x-fear", name: "Scared", promptFragment: "a frightened expression, tense and wary" },
  { id: "x-disgust", name: "Disgusted", promptFragment: "a disgusted grimace, nose wrinkled" },
  { id: "x-smirk", name: "Smirk", promptFragment: "a sly, confident smirk" },
  { id: "x-wink", name: "Wink", promptFragment: "winking with a playful grin" },
  { id: "x-determined", name: "Determined", promptFragment: "a determined, focused expression" },
  { id: "x-confused", name: "Confused", promptFragment: "a confused expression, one eyebrow raised" },
  { id: "x-sleepy", name: "Sleepy", promptFragment: "sleepy, heavy-lidded eyes, slight yawn" },
];

/** Resolve a selected expression id (builtin or user) to generation input. */
export async function resolveExpression(id: string | null): Promise<ExpressionInput | undefined> {
  if (!id) return undefined;
  const builtin = BUILTIN_EXPRESSIONS.find((x) => x.id === id);
  if (builtin) return { name: builtin.name, promptFragment: builtin.promptFragment };
  const user = await db.expressions.get(id);
  if (user)
    return { name: user.name, promptFragment: user.promptFragment, refAssetId: user.refAssetId };
  return undefined;
}
