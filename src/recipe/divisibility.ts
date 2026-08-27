/**
 * How far a kitchen divides one of what a line counts.
 *
 * A number alone says nothing about this. Half an egg is not an amount anyone
 * measures out; half an onion is a thing a knife makes in one stroke. The
 * difference lives in the food, so it is written down here rather than guessed
 * from the arithmetic.
 */

import type { Divisibility, UnitInfo } from "./units.js";
import { unitDivisibility } from "./units.js";

/**
 * A preparation rather than the thing it was made from.
 *
 * A chicken stock divides like a liquid and not like a chicken, and it has to be
 * read before the bird whose name it carries.
 */
const PREPARATION = /\b(stocks?|broths?|juices?|sauces?|purees?|purées?|soups?)\b/i;

/**
 * Things a kitchen takes one of or none of.
 *
 * An egg comes out of its shell whole, and so does the yolk or the white a
 * recipe asks for on its own: half of one would have to be beaten and weighed,
 * which is not an amount any recipe asks for and not one a cook can keep the
 * rest of. A zest is what comes off one fruit in one go, and a share of a zest
 * names no amount a cook stops at.
 */
const WHOLE_ITEM = /\b(eggs?|yolks?|egg\s+whites?|zests?)\b/i;

/**
 * Food that is already a portion on its own.
 *
 * A recipe counts five, twelve, twenty of them, and a cook taking a share puts
 * one fewer in the pan. Cutting one in two is not a thing a kitchen does.
 */
const PORTION_SIZED =
  /\b(shrimps?|prawns?|langoustines?|mussels?|clams?|hazelnuts?|peppercorns?|junipers?|anise|cloves?\s+of\s+spice)\b/i;

/** Things that split in two and no finer. */
const HALVED_ITEM = /\b(cans?|tins?|cloves?|garlic|gelatines?|gelatins?|leaf|leaves|sheets?)\b/i;

/**
 * Food a knife divides further, or whose quarter is still a portion someone
 * serves and whose remainder still keeps.
 */
const QUARTERED_ITEM =
  /\b(onions?|shallots?|potato(?:es)?|carrots?|apples?|pears?|lemons?|limes?|oranges?|tomato(?:es)?|cucumbers?|courgettes?|zucchinis?|aubergines?|eggplants?|squash(?:es)?|pumpkins?|cabbages?|melons?|watermelons?|peppers?|beets?|turnips?|parsnips?|leeks?|bananas?|mango(?:e?s)?|pineapples?|peach(?:es)?|apricots?|avocados?|legs?\s+of\s+lamb|baguettes?|camemberts?|chorizos?|chickens?|guinea\s+fowls?|roasts?)\b/i;

/**
 * How finely a kitchen divides one of what this line counts.
 *
 * The order the readings run in is the whole of the rule. A measure overrules
 * the food when it measures, because "100 g of apples" divides like a mass. A
 * preparation overrules the food it was made from. And what is left falls to a
 * half, which is the share most things give up by eye.
 */
export function divisibilityOf(unit: UnitInfo | null, item: string): Divisibility {
  if (unit?.measures) {
    return unitDivisibility(unit);
  }
  if (PREPARATION.test(item)) {
    return "half";
  }
  if (WHOLE_ITEM.test(item)) {
    return "whole";
  }
  if (PORTION_SIZED.test(item)) {
    return "whole";
  }
  if (HALVED_ITEM.test(item)) {
    return "half";
  }
  if (QUARTERED_ITEM.test(item)) {
    return "quarter";
  }
  return unit ? unitDivisibility(unit) : "half";
}
