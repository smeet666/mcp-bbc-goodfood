/**
 * How far apart two words are, counting a swap of neighbours as one slip.
 *
 * Plain edit distance charges two for a transposition, which puts the commonest
 * typing mistake beyond any sensible threshold: `qeury` and `query` differ by
 * one slip of the fingers and by two ordinary edits. Charging one for it is what
 * lets a slip be recognised as a slip, which is what turns a misspelled argument
 * into a suggestion rather than a bare refusal.
 *
 * Three rows are kept rather than the whole matrix: the row being filled, the
 * one above it that ordinary edits read, and the one above that, which is the
 * only place a transposition looks.
 */
export function editDistance(left: string, right: string): number {
  const width = right.length;
  let twoAbove: number[] = new Array<number>(width + 1).fill(0);
  let above = Array.from({ length: width + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    const current = new Array<number>(width + 1).fill(0);
    current[0] = row;

    for (let column = 1; column <= width; column += 1) {
      const same = left[row - 1] === right[column - 1];
      let cell = Math.min(
        (above[column - 1] as number) + (same ? 0 : 1),
        (above[column] as number) + 1,
        (current[column - 1] as number) + 1,
      );
      const swapped =
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1];
      if (swapped) {
        cell = Math.min(cell, (twoAbove[column - 2] as number) + 1);
      }
      current[column] = cell;
    }

    twoAbove = above;
    above = current;
  }

  return above[width] as number;
}
