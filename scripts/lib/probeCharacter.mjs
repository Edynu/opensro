// Character resolution for the rebuild/scripts probes, with the one rule that
// matters: `asd` is THE HUMAN USER'S character and probes must never touch it by
// accident. `asd2` is the swarm's scratch character.
//
// WHY THIS EXISTS. 35 probes defaulted to `asd`, and 19 of those read no
// character argument at all - so `node probe_foo.mjs asd2` was accepted by node,
// ignored by the script, and booted the user's character anyway. Several of
// those probes dropped gold, moved items and called the (retired) Node
// launcher-api's /mission/dev/reset-inventory. On
// 2026-07-25 that really happened: probe_drop_label_anchor.mjs dropped gold out
// of the user's bag across four runs (13:59-14:10), and probe_wave5_doll_rig.mjs
// recorded "characterName": "asd" in its own artifact at 13:20.
//
// A default is a convention and conventions get missed by the next probe author.
// This module makes the mistake FAIL instead: resolveProbeCharacter() defaults to
// the scratch character, and any attempt to reach the protected character throws
// unless the caller sets SRO_PROBE_ALLOW_USER_CHARACTER=1, which also prints a
// warning naming the character it is about to touch.
//
// Usage in a probe:
//   import { resolveProbeCharacter } from "./lib/probeCharacter.mjs";
//   const characterName = resolveProbeCharacter();              // argv[2], else $SRO_PROBE_CHARACTER, else Test2
//   const characterName = resolveProbeCharacter({ argvIndex: 3 });  // when argv[2] is already taken

/** The human user's character. Probes must not reach this without an opt-in. */
export const PROTECTED_CHARACTER = "asd";

/** The swarm's scratch character - the default for every probe. */
export const SCRATCH_CHARACTER = "Test2";

/** Set to 1/true to permit the protected character. Deliberately an env var. */
export const OPT_IN_ENV = "SRO_PROBE_ALLOW_USER_CHARACTER";

/** Env var the probes read for a character override (AGENT-P's convention). */
export const CHARACTER_ENV = "SRO_PROBE_CHARACTER";

function normalise(name) {
  return String(name ?? "").trim();
}

/** True when `name` is the protected character, case- and space-insensitively. */
export function isProtectedCharacter(name) {
  return normalise(name).toLowerCase() === PROTECTED_CHARACTER;
}

function optedIn() {
  const raw = normalise(process.env[OPT_IN_ENV]).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Gate a character name. Returns it unchanged when it is safe, or when the
 * caller has explicitly opted in (in which case it warns loudly). Throws
 * otherwise, so a probe that would have silently booted the user's character
 * dies before it opens a browser.
 *
 * `context` names the caller in the message - pass a script name or the endpoint
 * about to be called, so the failure says which probe and which operation.
 */
export function assertCharacterAllowed(name, { context = "this probe" } = {}) {
  const resolved = normalise(name);
  if (!isProtectedCharacter(resolved)) {
    return resolved;
  }
  if (!optedIn()) {
    throw new Error(
      [
        "",
        "=".repeat(78),
        `REFUSED: ${context} tried to use character "${resolved}".`,
        "",
        `"${PROTECTED_CHARACTER}" is the HUMAN USER'S character. Probes drop gold, move`,
        "items and equip gear - running one against",
        "the user's save damages someone's actual game progress, and a run that measures",
        "the wrong subject is worthless as evidence anyway.",
        "",
        `Use the scratch character instead:   ${SCRATCH_CHARACTER}`,
        "",
        "If you genuinely need the user's character to reproduce something, opt in",
        "explicitly and accept that you are about to touch their save:",
        `  $env:${OPT_IN_ENV}="1"`,
        "=".repeat(78),
        ""
      ].join("\n")
    );
  }
  console.warn(
    [
      "",
      "!".repeat(78),
      `!! WARNING: running against "${resolved}" - THE HUMAN USER'S OWN CHARACTER.`,
      `!! ${context}`,
      "!!",
      "!! This probe may drop gold, move or equip items, or reset the inventory of",
      "!! a character a real person plays. You enabled this by setting",
      `!! ${OPT_IN_ENV}. Unset it to go back to ${SCRATCH_CHARACTER}.`,
      "!".repeat(78),
      ""
    ].join("\n")
  );
  return resolved;
}

/**
 * Catch a character name passed in the WRONG positional slot.
 *
 * Some probes spent argv[2] on a deviceScaleFactor before they took a character,
 * so the character sits at argv[3]. `node probe_foo.mjs asd` then puts "asd"
 * where the DPR belongs: the run silently proceeds on the scratch character with
 * deviceScaleFactor=NaN, and the caller believes they targeted `asd`. That is the
 * same "argument accepted then ignored" defect this module exists to kill, only
 * pointing the safe way - and a green run that measured the wrong subject is
 * still worthless. So: refuse, and say where the name belongs.
 *
 * Only exact character names trip this, never an arbitrary string, so a probe
 * with a legitimate non-numeric argv[2] (a tag, a mode) is unaffected.
 */
export function assertNoMisplacedCharacterArg(argvIndex, context = "this probe") {
  if (argvIndex <= 2) {
    return;
  }
  const known = new Set([PROTECTED_CHARACTER, SCRATCH_CHARACTER]);
  for (let i = 2; i < argvIndex; i += 1) {
    const value = normalise(process.argv[i]).toLowerCase();
    if (value && known.has(value)) {
      throw new Error(
        [
          "",
          "=".repeat(78),
          `REFUSED: ${context} got the character name "${process.argv[i]}" in argv[${i}],`,
          `but this probe reads the character from argv[${argvIndex}].`,
          "",
          `argv[${i}] is a different parameter (usually deviceScaleFactor), so your name`,
          "would have been parsed as a number and thrown away, and the probe would have",
          `run on ${SCRATCH_CHARACTER} while you believed otherwise.`,
          "",
          `Pass it in the right position, or use the env override:`,
          `  $env:${CHARACTER_ENV}="<name>"`,
          "=".repeat(78),
          ""
        ].join("\n")
      );
    }
  }
}

/**
 * True when `value` is something Number() turns into a usable number. Used to
 * tell a deviceScaleFactor apart from a character name by SHAPE rather than by
 * matching a list of names we happen to know about.
 */
function looksNumeric(value) {
  const text = normalise(value);
  return text !== "" && Number.isFinite(Number(text));
}

/**
 * Catch a positional argument that landed in a slot of the wrong TYPE.
 *
 * assertNoMisplacedCharacterArg() above only fires on the exact strings "asd"
 * and "asd2", which leaves two gaps that are the same defect wearing a hat:
 *
 *   REVERSE - the character is at argv[2] and a NUMBER lives at argv[3]. Run
 *   `node probe.mjs 1.5` and "1.5" becomes the CHARACTER NAME. It is not the
 *   protected name, so the guard waves it through, and the probe boots a
 *   character that does not exist while the DPR silently keeps its default.
 *
 *   THIRD NAME - any character that is neither asd nor asd2 dropped into a
 *   numeric slot is still coerced to NaN and thrown away in silence.
 *
 * Checking the shape of each slot closes both, and keeps closing them when
 * someone adds a third character next week. `numericArgvIndexes` are the slots
 * this probe parses as numbers; `argvIndex` is where the character belongs.
 */
export function assertPositionalArgShapes(numericArgvIndexes, argvIndex, context = "this probe") {
  for (const index of numericArgvIndexes) {
    const raw = process.argv[index];
    if (raw === undefined || normalise(raw) === "") {
      continue;
    }
    if (!looksNumeric(raw)) {
      throw new Error(
        [
          "",
          "=".repeat(78),
          `REFUSED: ${context} got "${raw}" in argv[${index}], which this probe parses as a`,
          "number. Number() would have made it NaN and the run would have continued with a",
          "meaningless value while reporting success.",
          "",
          argvIndex >= 0
            ? `If you meant to choose the character, it reads argv[${argvIndex}].`
            : "This probe does not take a character positionally.",
          `You can always use the env override instead:  $env:${CHARACTER_ENV}="<name>"`,
          "=".repeat(78),
          ""
        ].join("\n")
      );
    }
  }
  if (argvIndex >= 0 && looksNumeric(process.argv[argvIndex])) {
    throw new Error(
      [
        "",
        "=".repeat(78),
        `REFUSED: ${context} got the number "${process.argv[argvIndex]}" in argv[${argvIndex}],`,
        "but that slot is the CHARACTER NAME.",
        "",
        "No character is named after a number, so this is a positional mix-up: the probe",
        "would have booted a character that does not exist, and whichever numeric parameter",
        "you meant to set would have kept its default. Either way the run would not have",
        "measured what you asked for.",
        "",
        numericArgvIndexes.length > 0
          ? `This probe reads its number(s) from argv[${numericArgvIndexes.join("], argv[")}].`
          : "This probe takes no positional number.",
        "=".repeat(78),
        ""
      ].join("\n")
    );
  }
}

/**
 * Resolve the character a probe should run against.
 *
 * Precedence: argv[argvIndex] -> $SRO_PROBE_CHARACTER (plus any extra envKeys)
 * -> the scratch character. An explicit override always wins, so a caller who
 * passes a name is honoured; what is impossible is DEFAULTING to the user.
 *
 * `argvIndex` exists because some probes already spend argv[2] on something else
 * (deviceScaleFactor, most often). Pass the real index rather than letting a
 * character name be parsed as a number. `numericArgvIndexes` declares which
 * slots this probe parses as numbers so a swapped pair refuses instead of
 * running with NaN.
 */
export function resolveProbeCharacter({
  argvIndex = 2,
  numericArgvIndexes = [],
  envKeys = [],
  fallback = SCRATCH_CHARACTER,
  context = "this probe"
} = {}) {
  assertNoMisplacedCharacterArg(argvIndex, context);
  assertPositionalArgShapes(numericArgvIndexes, argvIndex, context);
  const fromArgv = argvIndex >= 0 ? normalise(process.argv[argvIndex]) : "";
  if (fromArgv) {
    return assertCharacterAllowed(fromArgv, { context: `${context} (argv[${argvIndex}])` });
  }
  for (const key of [CHARACTER_ENV, ...envKeys]) {
    const fromEnv = normalise(process.env[key]);
    if (fromEnv) {
      return assertCharacterAllowed(fromEnv, { context: `${context} ($${key})` });
    }
  }
  return assertCharacterAllowed(fallback, { context: `${context} (default)` });
}
