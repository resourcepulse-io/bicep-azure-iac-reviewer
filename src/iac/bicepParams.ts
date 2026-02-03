export type BicepParamValue = string | number | boolean;

export interface BicepParamParseResult {
  params: Record<string, BicepParamValue>;
  errors: string[];
}

function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '/' && !inSingle && !inDouble && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }

  return line;
}

function parseValue(raw: string): BicepParamValue | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  return undefined;
}

export function parseBicepParamFile(contents: string): BicepParamParseResult {
  const params: Record<string, BicepParamValue> = {};
  const errors: string[] = [];

  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = stripLineComment(lines[index]);
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('using ')) {
      continue;
    }

    const match = trimmed.match(/^param\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const name = match[1];
    const valueRaw = match[2].trim();
    const value = parseValue(valueRaw);
    if (value === undefined) {
      errors.push(
        `Line ${index + 1}: unsupported value for param "${name}" (only string, boolean, and integer are supported)`
      );
      continue;
    }

    params[name] = value;
  }

  return { params, errors };
}
