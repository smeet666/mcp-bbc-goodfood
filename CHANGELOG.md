# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `list_filters`, which publishes the axes a recipe search can be narrowed
  along, with the values each one takes and how many recipes carry them. Pass a
  query to measure the counts inside one search, or leave it out for the site's
  whole listing.
- `search_recipes`, which searches the site and returns a listing. It narrows by
  diet, cuisine, meal type, difficulty, a bound on time, calories, servings or
  rating, and `exclude_premium` leaves out what sits behind the site's
  subscription. Every row carries the path of its page.
- `get_recipe`, which reads one recipe from the path a search row carries: its
  ingredients, its steps, its times, its rating and its nutrition. A recipe
  behind the site's subscription comes back with everything except its
  ingredients and steps, and says so.
- `scale_ingredients`, which puts a list of ingredient lines to a different
  number of people without reading anything on the site. Every line says under
  `scaling` whether the arithmetic landed exactly or whether the figure moved to
  stay usable in a kitchen.
  A quantity is said in the unit that states it exactly: 2 g divided by ten come
  back as 200 mg, and 200 g multiplied by twenty come back as 4 kg. A figure
  rises only when the larger unit states it exactly, so 7492.5 g stays in grams.
- `servings` on `get_recipe`, which puts the recipe to that many people. A
  recipe whose page states no number of servings is left as the site publishes
  it, and a note says why.
- `total_is_ceiling` on the answers that carry a total, which says the figure
  landed on the largest number of rows one search will serve and therefore
  states a floor rather than a count.
