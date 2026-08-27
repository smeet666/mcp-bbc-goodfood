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

/** Coarsest first: a share nobody takes is worse than one nobody needed. */
const FINENESS: Readonly<Record<Divisibility, number>> = { whole: 0, half: 1, quarter: 2 };

/** Of two readings of one line, the one that offers the larger share. */
function coarser(left: Divisibility, right: Divisibility): Divisibility {
  return FINENESS[left] <= FINENESS[right] ? left : right;
}

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
  /\b(shrimps?|prawns?|langoustines?|mussels?|clams?|scallops?|hazelnuts?|peppercorns?|junipers?|anise|sausages?|chipolatas?|rashers?|tortillas?|wraps?|pittas?|buns?|pods?|chops?|cloves?\s+of\s+spice)\b/i;

/**
 * A sheet of something a recipe soaks or layers.
 *
 * These are read before leaves are, because gelatine is sold in leaves and a
 * leaf of gelatine halves where a bay leaf does not.
 */
const LAYERED = /\b(gelatines?|gelatins?|filo|phyllo|lasagne|lasagna|pastry|rice\s+paper)\b/i;

/** A leaf a recipe picks off a herb, which is a thing a cook counts. */
const HERB_LEAF = /\b(leaf|leaves)\b/i;

/** Words that name a small one of something a knife would otherwise quarter. */
const SMALL_SIZED = /\b(cherry|sun-?dried|baby|new|dried)\b/i;

/** A bird a recipe counts pieces of rather than birds. */
const POULTRY = /\b(chickens?|turkeys?|ducks?|poussins?)\b/i;
const POULTRY_CUT = /\b(thighs?|drumsticks?|breasts?|wings?|legs?|fillets?)\b/i;

/** Things that split in two and no finer. */
const HALVED_ITEM = /\b(cans?|tins?|cloves?|garlic|sheets?)\b/i;

/**
 * Food a knife divides further, or whose quarter is still a portion someone
 * serves and whose remainder still keeps.
 */
const QUARTERED_ITEM =
  /\b(onions?|shallots?|potato(?:es)?|carrots?|apples?|pears?|lemons?|limes?|oranges?|tomato(?:es)?|cucumbers?|courgettes?|zucchinis?|aubergines?|eggplants?|squash(?:es)?|pumpkins?|cabbages?|melons?|watermelons?|peppers?|beets?|turnips?|parsnips?|leeks?|bananas?|mango(?:e?s)?|pineapples?|peach(?:es)?|apricots?|avocados?|legs?\s+of\s+lamb|baguettes?|camemberts?|chorizos?|chickens?|guinea\s+fowls?|roasts?)\b/i;

/**
 * How finely a kitchen divides one of this food, read from its name alone.
 *
 * The order the readings run in is the whole of the rule. A preparation
 * overrules the food it was made from, a size overrules the knife, and a cut of
 * poultry overrules the bird.
 */
function fromFood(item: string): Divisibility {
  if (PREPARATION.test(item)) {
    return "half";
  }
  if (WHOLE_ITEM.test(item) || PORTION_SIZED.test(item)) {
    return "whole";
  }
  if (LAYERED.test(item)) {
    return "half";
  }
  if (HERB_LEAF.test(item)) {
    return "whole";
  }
  if (POULTRY.test(item) && POULTRY_CUT.test(item)) {
    return "whole";
  }
  if (SMALL_SIZED.test(item) && QUARTERED_ITEM.test(item)) {
    return "whole";
  }
  if (HALVED_ITEM.test(item)) {
    return "half";
  }
  return QUARTERED_ITEM.test(item) ? "quarter" : "half";
}

/**
 * How finely a kitchen divides one of what this line counts.
 *
 * A measure overrules the food outright, because "100 g of apples" divides like
 * a mass. A unit that counts does not: it bounds the division alongside the
 * food, and the larger of the two shares wins. A tin of tomatoes halves because
 * a tin halves, whatever a knife would do to the tomatoes inside it.
 */
export function divisibilityOf(unit: UnitInfo | null, item: string): Divisibility {
  if (unit?.measures) {
    return unitDivisibility(unit);
  }
  const food = fromFood(item);
  return unit === null ? food : coarser(unitDivisibility(unit), food);
}
