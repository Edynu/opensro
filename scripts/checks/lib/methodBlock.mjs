// Deterministic method-body extraction for fidelity checks.
//
// extractMethodBlock(source, methodName) finds the DECLARATION of
// `methodName( ... ) ... {` (not banner-comment mentions, not call sites)
// and returns the slice from the declaration through its matching close
// brace, walking brace depth while skipping string literals, template
// literals (including ${} nesting), and comments. Returns "" when the
// declaration cannot be found.
//
// This replaces a `\n  \}` indentation-anchored regex that silently died
// when the target file moved to tab indentation.

/**
 * Skip a string/template/comment region starting at `index`. Returns the
 * index of the first character AFTER the region, or source.length.
 */
function skipNonCode(source, index) {
  const ch = source[index];

  if (ch === "/" && source[index + 1] === "/") {
    const end = source.indexOf("\n", index + 2);
    return end === -1 ? source.length : end + 1;
  }

  if (ch === "/" && source[index + 1] === "*") {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (ch === "'" || ch === '"') {
    let i = index + 1;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === ch || source[i] === "\n") {
        return i + 1;
      }
      i += 1;
    }
    return source.length;
  }

  if (ch === "`") {
    let i = index + 1;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === "`") {
        return i + 1;
      }
      if (source[i] === "$" && source[i + 1] === "{") {
        // Template expression: recurse over nested braces / strings.
        let depth = 1;
        i += 2;
        while (i < source.length && depth > 0) {
          const skipped = maybeSkipNonCode(source, i);
          if (skipped > i) {
            i = skipped;
            continue;
          }
          if (source[i] === "{") {
            depth += 1;
          } else if (source[i] === "}") {
            depth -= 1;
          }
          i += 1;
        }
        continue;
      }
      i += 1;
    }
    return source.length;
  }

  return index;
}

/** Keywords a regex literal may directly follow (else `/` is division). */
const REGEX_MAY_FOLLOW = new Set([
  "return", "typeof", "instanceof", "in", "of", "case", "do", "else", "yield",
  "await", "new", "delete", "void", "throw"
]);

/**
 * Whether a `/` at `index` starts a regex literal rather than a division:
 * true at start of input, after an operator/opening punctuator, or after a
 * keyword an expression may follow.
 */
function regexCanStartAt(source, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(source[i])) {
    i -= 1;
  }
  if (i < 0) {
    return true;
  }
  if ("(,=:[!&|?{};+*-%^~<>".includes(source[i])) {
    return true;
  }

  let wordStart = i;
  while (wordStart >= 0 && /[\w$]/.test(source[wordStart])) {
    wordStart -= 1;
  }
  return REGEX_MAY_FOLLOW.has(source.slice(wordStart + 1, i + 1));
}

/**
 * Skip a regex literal starting at `index`. `/` only terminates OUTSIDE a
 * character class, and backslash escapes apply inside the class too.
 * Returns the index after the literal (including flags).
 */
function skipRegexLiteral(source, index) {
  let i = index + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") {
      return i;
    }
    if (inClass) {
      if (ch === "]") {
        inClass = false;
      }
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) {
        i += 1;
      }
      return i;
    }
    i += 1;
  }
  return source.length;
}

/** Returns the index after a non-code region at `index`, or `index` if code. */
function maybeSkipNonCode(source, index) {
  const ch = source[index];
  if (ch === "'" || ch === '"' || ch === "`") {
    return skipNonCode(source, index);
  }
  if (ch === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
    return skipNonCode(source, index);
  }
  if (ch === "/" && regexCanStartAt(source, index)) {
    return skipRegexLiteral(source, index);
  }
  return index;
}

/**
 * Find the declaration of `methodName` in `source` and return
 * { start, bodyOpen } where `start` is the index of the method name and
 * `bodyOpen` is the index of the `{` opening its body, or null.
 *
 * A declaration is `methodName` followed (after optional whitespace) by a
 * balanced `( ... )` parameter list, then an optional `: ReturnType`
 * annotation, then `{`. A call site ends in `;`/`)`/`,` instead and is
 * rejected. Occurrences inside comments or strings are skipped, which is
 * what keeps banner-comment mentions from matching.
 */
function findDeclaration(source, methodName) {
  let i = 0;

  while (i < source.length) {
    const skipped = maybeSkipNonCode(source, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }

    if (!source.startsWith(methodName, i)) {
      i += 1;
      continue;
    }

    // Reject identifier-continuations on either side (e.g. `xrenderMyself`).
    const before = source[i - 1];
    const after = source[i + methodName.length];
    if (before && /[\w$.:]/.test(before)) {
      i += methodName.length;
      continue;
    }

    let j = i + methodName.length;
    while (j < source.length && /\s/.test(source[j])) {
      j += 1;
    }
    if (source[j] !== "(") {
      i += methodName.length;
      continue;
    }

    // Walk the balanced parameter list.
    let parenDepth = 0;
    while (j < source.length) {
      const skippedInner = maybeSkipNonCode(source, j);
      if (skippedInner > j) {
        j = skippedInner;
        continue;
      }
      if (source[j] === "(") {
        parenDepth += 1;
      } else if (source[j] === ")") {
        parenDepth -= 1;
        if (parenDepth === 0) {
          j += 1;
          break;
        }
      }
      j += 1;
    }

    // Optional `: ReturnType` then `{` marks a declaration.
    while (j < source.length && /\s/.test(source[j])) {
      j += 1;
    }
    if (source[j] === ":") {
      j += 1;
      while (j < source.length && source[j] !== "{" && source[j] !== ";" && source[j] !== "\n") {
        j += 1;
      }
      while (j < source.length && /\s/.test(source[j])) {
        j += 1;
      }
    }
    if (source[j] === "{") {
      return { start: i, bodyOpen: j };
    }

    i += methodName.length;
    void after;
  }

  return null;
}

/**
 * Extract the full text of method `methodName` (declaration through the
 * matching close brace). Returns "" if the declaration is not found or the
 * braces never balance.
 */
export function extractMethodBlock(source, methodName) {
  const declaration = findDeclaration(source, methodName);
  if (!declaration) {
    return "";
  }

  let depth = 0;
  let i = declaration.bodyOpen;
  while (i < source.length) {
    const skipped = maybeSkipNonCode(source, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }
    if (source[i] === "{") {
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(declaration.start, i + 1);
      }
    }
    i += 1;
  }

  return "";
}
