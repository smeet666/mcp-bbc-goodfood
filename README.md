<img src="assets/icon-128.png" alt="" width="96" align="right">

# mcp-bbc-goodfood

[![npm](https://img.shields.io/npm/v/mcp-bbc-goodfood.svg)](https://www.npmjs.com/package/mcp-bbc-goodfood)
[![CI](https://github.com/smeet666/mcp-bbc-goodfood/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-bbc-goodfood/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-bbc-goodfood.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.smeet666/mcp-bbc-goodfood)
[![Glama](https://glama.ai/mcp/servers/smeet666/mcp-bbc-goodfood/badges/score.svg)](https://glama.ai/mcp/servers/smeet666/mcp-bbc-goodfood)
[![M8ven](https://m8ven.ai/badge/mcp/smeet666-mcp-bbc-goodfood-mij0e9?variant=verified)](https://m8ven.ai/mcp/smeet666-mcp-bbc-goodfood-mij0e9)
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=bbc-goodfood&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1iYmMtZ29vZGZvb2QiXX0%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=bbc-goodfood&config=%7B%22name%22%3A%22bbc-goodfood%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-bbc-goodfood%22%5D%7D)

[BBC Good Food](https://www.bbcgoodfood.com) is a British cooking site, the
online home of the magazine of the same name. Its recipes are written and tested
by its own cooks, and each one gives its ingredients, its method, its
preparation and cooking times, its difficulty, the diets it suits, its nutrition
per serving and the stars its readers gave it. The site narrows its recipes along
axes of its own: a diet, a cuisine, a kind of meal, a difficulty. Part of the
collection sits behind a subscription.

This server connects a chat client to that site. You can read the values each
axis takes, search the recipes along them, read one recipe with its ingredients
rescaled to the number of people at your table, and switch its quantities between
metric and US units. It needs no API key and no account.

_[Version française](#mcp-bbc-goodfood-français)_

---

## Install

**One-click install**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=bbc-goodfood&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1iYmMtZ29vZGZvb2QiXX0%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=bbc-goodfood&config=%7B%22name%22%3A%22bbc-goodfood%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-bbc-goodfood%22%5D%7D)

**Claude Code**

```bash
claude mcp add bbc-goodfood -- npx -y mcp-bbc-goodfood
```

**Claude Desktop, Cursor, and any client using the standard config format**

```json
{
  "mcpServers": {
    "bbc-goodfood": {
      "command": "npx",
      "args": ["-y", "mcp-bbc-goodfood"]
    }
  }
}
```

Node 24 or later is required, and no environment variable has to be set.

### With Docker

```json
{
  "mcpServers": {
    "bbc-goodfood": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-bbc-goodfood:1.0.1"]
    }
  }
}
```

`-i` keeps stdin open, which is where the protocol travels, and `-t` is left out
because a TTY rewrites the stream. The container needs outbound HTTPS to
`www.bbcgoodfood.com`, and nothing else: no volume, no port, no credential.

### Bundle, without npm

Download `mcp-bbc-goodfood-1.0.1.mcpb` from
[the latest release](https://github.com/smeet666/mcp-bbc-goodfood/releases/latest)
and open it. A client that supports MCP bundles installs it on its own, with no
npm and no configuration file to edit. The bundle carries its dependencies, so
nothing is fetched at install time.

## What you can ask

- "Find me a vegetarian curry that takes under 40 minutes."
- "What diets can I filter on?"
- "Read me that recipe for six, in US cups."
- "Which of these are rated four stars or better?"
- "Scale this ingredient list from a magazine by 1.5."

The ordinary path runs `list_filters`, then `search_recipes`, then `get_recipe`
on the path a row carries.

## Tools

| Tool                | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `list_filters`      | Reads the values each axis of the site takes.              |
| `search_recipes`    | Finds recipes, narrowed along those axes.                  |
| `get_recipe`        | Reads one recipe, rescaled or in other units on request.   |
| `scale_ingredients` | Rescales any ingredient list, with no request to the site. |

**Call `list_filters` before narrowing a search.** The site accepts any value on
an axis and answers one it does not know with a total of zero, so a guessed
spelling comes back as a confident absence instead of a refusal.

### `list_filters`

Reads the axes the site narrows by, and the values each one takes.

| Argument | Type                       | Required | What it does                                                            |
| -------- | -------------------------- | -------- | ----------------------------------------------------------------------- |
| `query`  | string, 1 to 80 characters | no       | Count the values within one search instead of across the whole listing. |

**In return:** `filters`, one entry per axis carrying `name` and `label` in the
site's own wording, `argument`, which names the argument `search_recipes` takes
for it, and `options` with each `value`, its `label` and its `count`. A `count`
the site published nothing for is `null`. `option_count` says how many options are
listed here, which is fewer than the site accepts: the values returned are the
most frequent ones, and an option absent from the list is still usable. Counts
are measured inside a scope, so passing `query` counts within one search and
leaving it out counts across the listing; the two answer different questions.

### `search_recipes`

Searches the recipes, narrowed along the site's own axes and along restrictions
this server applies to the rows it read.

| Argument            | Type                                                                | Required | What it does                                  |
| ------------------- | ------------------------------------------------------------------- | -------- | --------------------------------------------- |
| `query`             | string, 1 to 80 characters                                          | yes      | A dish, an ingredient, a technique.           |
| `limit`             | integer, 1 to 30, default `30`                                      | no       | Rows to serve.                                |
| `page`              | integer, 1 to 334, default `1`                                      | no       | Which page of rows.                           |
| `sort`              | `relevant`, `rating`, `published` or `quickest`, default `relevant` | no       | How the site orders the rows.                 |
| `diet`              | string, 1 to 60 characters                                          | no       | A value `list_filters` publishes.             |
| `cuisine`           | string, 1 to 60 characters                                          | no       | A value `list_filters` publishes.             |
| `meal_type`         | string, 1 to 60 characters                                          | no       | A value `list_filters` publishes.             |
| `difficulty`        | string, 1 to 60 characters                                          | no       | A value `list_filters` publishes.             |
| `max_total_minutes` | integer, 1 to 1440                                                  | no       | The whole recipe, in minutes.                 |
| `max_calories`      | integer, 1 to 10000                                                 | no       | Calories per serving.                         |
| `min_servings`      | integer, 1 to 50                                                    | no       | At least this many servings.                  |
| `min_rating`        | number, 1 to 5                                                      | no       | At least this many stars.                     |
| `exclude_premium`   | boolean                                                             | no       | Drop the rows behind the site's subscription. |

**In return:** rows carrying `id`, which `get_recipe` takes; `title`; `url`;
`image_url`; and `rating`, which is `null` where the site published none.
Alongside come `result_count`, `rows_seen` for the rows the site served before
anything was set aside, and `total_available`. A total marked `total_is_ceiling`
sits on the largest number of rows one search will serve, so it states a floor
rather than a count. `restrictions_lifted` names what was set aside when
narrowing made the search fail, and `premium_dropped` counts the subscription
rows removed. The site offers no restriction on subscription rows, so
`exclude_premium` removes them after the page arrives: a page then comes back
shorter than the limit asked for, and a short page is not the end of the results.

### `get_recipe`

Reads one recipe, rescaled to a number of servings and in the unit system asked
for.

| Argument      | Type                        | Required | What it does                                               |
| ------------- | --------------------------- | -------- | ---------------------------------------------------------- |
| `id`          | string, 1 to 200 characters | yes      | The page's own path, as a `search_recipes` row carries it. |
| `servings`    | integer, 1 to 100           | no       | Rescale the ingredients to this many servings.             |
| `unit_system` | `metric` or `us`            | no       | The units the quantities are written in.                   |

**In return:** `title`, `url`, `premium`, `yield_text` in the site's own wording
such as `Serves 4 - 6`, `yield_count`, `prep_minutes`, `cook_minutes`,
`total_minutes`, `difficulty`, `diets`, `author`, `rating`, `rating_count`,
`description`, `ingredients`, `steps`, `nutrition` with `nutrition_per` naming
the serving it describes, and `unit_system`. A figure the page states nothing for
is `null`. **A recipe behind the site's subscription comes back with `premium`
true, no ingredients and no steps:** send the reader to its page rather than
reconstructing them. Each ingredient carries `scaling`, reading `scaled`,
`rounded` or `unscaled`.

### `scale_ingredients`

Applies the same arithmetic to any list of ingredient lines, with no request to
the site.

| Argument        | Type                                           | Required   | What it does                                   |
| --------------- | ---------------------------------------------- | ---------- | ---------------------------------------------- |
| `ingredients`   | array of 1 to 100 strings, 1 to 300 characters | yes        | The lines to rescale, as a recipe writes them. |
| `factor`        | number, 0.001 to 1000                          | one of two | What to multiply every quantity by.            |
| `from_servings` | integer, 1 to 100                              | one of two | How many people the list feeds as written.     |
| `to_servings`   | integer, 1 to 100                              | one of two | How many people it should feed.                |

Pass `factor`, or the `from_servings` and `to_servings` pair.

**In return:** the rescaled lines in the shape `get_recipe` returns, each with its
`original`, its `text`, its `amount`, `amount_max` and `unit`, and its `scaling`.

## Rescaling the quantities

A quantity is stated in the unit that suits it, so a line can come back in a
different unit from the one the recipe used: 200 g multiplied by twenty reads
`4 kg`, and 2 g divided by ten reads `200 mg`.

How finely an ingredient can be divided depends on what it is. A loaf can be cut
in two, in three or in four; an egg cannot be shared out. A quantity landing
between the two is rounded, and the rescaled recipe then departs a little from
the proportions of the original. The line carries `rounded`, and its note says
what was done.

The figures are this server's arithmetic, so say they were recomputed when you
show them. A recipe whose page states no number of servings cannot be put to a
number of people, and the answer says so.

## Configuration

Every variable is optional. Set them in the `env` block of your client config.

| Variable                | Default              | What it does                                                                       |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `BGF_USER_AGENT`        | the project identity | Names your application to the site, with an address where a person can be reached. |
| `BGF_MIN_INTERVAL_MS`   | `1500`               | Gap between two requests, from 1000 to 60000.                                      |
| `BGF_TIMEOUT_MS`        | `20000`              | Deadline for one request, from 1000 to 120000.                                     |
| `BGF_MAX_RETRIES`       | `3`                  | Attempts after a transient failure, from 0 to 8.                                   |
| `BGF_CACHE_TTL_MS`      | `900000`             | How long a page stays in memory, from 0 to 86400000.                               |
| `BGF_CACHE_MAX_ENTRIES` | `200`                | Pages held in memory at once, from 1 to 5000.                                      |
| `BGF_LOG_LEVEL`         | `error`              | `silent`, `error`, `info` or `debug`, written to stderr.                           |

A value outside its range falls back to the default, and the reason is written to
stderr.

## Errors

Every failure carries one of six codes, a message, and where it helps a hint
naming the next move.

| Code            | What happened                                           | What to do                                                                                                   |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `not_found`     | The site answered, and holds no such recipe.            | Check the path with `search_recipes`.                                                                        |
| `invalid_input` | The arguments were refused before any request went out. | Read the message, which names the argument.                                                                  |
| `rate_limited`  | The site asked this client to slow down.                | Wait the number of seconds the hint names and call again with the same arguments. The recipe is still there. |
| `parse_failure` | The page loaded and the expected content was absent.    | Report it at [the issue tracker](https://github.com/smeet666/mcp-bbc-goodfood/issues).                       |
| `network_error` | The request did not complete.                           | Try again shortly.                                                                                           |
| `timeout`       | The request passed its deadline.                        | Raise `BGF_TIMEOUT_MS`, or ask for fewer rows.                                                               |

## As a library

The layer reading the site is published on its own, with its pacing, its cache
and its errors, and with no protocol attached.

```ts
import { BbcGoodFoodClient } from "mcp-bbc-goodfood/client";

const client = new BbcGoodFoodClient();
const { data, cached } = await client.searchRecipes({ query: "lasagne" });
console.log(data.rows.length, cached);
```

`listFilters`, `searchRecipes` and `getRecipe` each answer `{ data, cached }`,
and throw an error carrying one of the six codes. The floor between two requests
holds here as well.

## Pacing and attribution

Requests go out one at a time with at least a second and a half between them, and
the floor of one second holds however the server is configured. The `User-Agent`
always ends with the project identity and an address where a person can be
reached.

Every result carries the address of the page it was read from, and `source` names
the site. The recipes belong to BBC Good Food and to the cooks who wrote them.

This MCP server is an unofficial project, with no affiliation to BBC Good Food.

## Privacy

This server collects nothing about you and sends nothing to its author. It runs
on your machine, contacts `www.bbcgoodfood.com` and nothing else, holds its answers in memory
while it runs, and writes nothing to disk.
[PRIVACY.md](PRIVACY.md) states what a request carries and which settings change
any of it.

## Development

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Tests run against generated fixtures and make no network request. The live suite,
`npm run test:live`, makes one request per route and runs nightly against the
site itself.

## Contributing

Bugs, questions and ideas belong in
[the issue tracker](https://github.com/smeet666/mcp-bbc-goodfood/issues). Pull
requests are welcome; opening an issue first helps agree on the shape of the
change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE). The recipes belong to BBC Good Food and to their
authors.

---

<a name="mcp-bbc-goodfood-français"></a>

# mcp-bbc-goodfood (français)

_[English version](#mcp-bbc-goodfood)_

[BBC Good Food](https://www.bbcgoodfood.com) est un site de cuisine britannique,
la maison en ligne du magazine du même nom. Ses recettes sont écrites et testées
par ses propres cuisiniers, et chacune donne ses ingrédients, sa méthode, ses
temps de préparation et de cuisson, sa difficulté, les régimes auxquels elle
convient, ses valeurs nutritionnelles par portion et les étoiles que ses lecteurs
lui ont données. Le site resserre ses recettes selon des axes qui lui sont
propres : un régime, une cuisine, un type de repas, une difficulté. Une partie de
la collection est réservée aux abonnés.

Ce serveur relie un client de conversation à ce site. On peut lire les valeurs
que prend chaque axe, chercher des recettes le long de ces axes, lire une recette
avec ses ingrédients adaptés au nombre de convives, et basculer ses quantités
entre unités métriques et américaines. Aucune clé d'API, aucun compte.

## Installation

**Installation en un clic**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=bbc-goodfood&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1iYmMtZ29vZGZvb2QiXX0%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=bbc-goodfood&config=%7B%22name%22%3A%22bbc-goodfood%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-bbc-goodfood%22%5D%7D)

**Claude Code**

```bash
claude mcp add bbc-goodfood -- npx -y mcp-bbc-goodfood
```

**Claude Desktop, Cursor, et tout client au format de configuration standard**

```json
{
  "mcpServers": {
    "bbc-goodfood": {
      "command": "npx",
      "args": ["-y", "mcp-bbc-goodfood"]
    }
  }
}
```

Node 24 ou plus récent est nécessaire, et aucune variable d'environnement n'est à
renseigner.

### Avec Docker

```json
{
  "mcpServers": {
    "bbc-goodfood": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-bbc-goodfood:1.0.1"]
    }
  }
}
```

`-i` garde l'entrée standard ouverte, qui est le canal du protocole, et `-t` est
omis parce qu'un TTY réécrit le flux. Le conteneur a besoin d'un accès HTTPS
sortant vers `www.bbcgoodfood.com`, et de rien d'autre : aucun volume, aucun
port, aucun identifiant.

### Bundle, sans npm

Téléchargez `mcp-bbc-goodfood-1.0.1.mcpb` depuis
[la dernière publication](https://github.com/smeet666/mcp-bbc-goodfood/releases/latest)
et ouvrez-le. Un client qui gère les bundles MCP l'installe seul, sans npm et
sans fichier de configuration à modifier. Le bundle emporte ses dépendances, donc
rien n'est téléchargé à l'installation.

## Ce qu'on peut demander

- « Trouve-moi un curry végétarien qui prend moins de 40 minutes. »
- « Sur quels régimes puis-je filtrer ? »
- « Lis-moi cette recette pour six, en tasses américaines. »
- « Lesquelles sont notées quatre étoiles ou plus ? »
- « Multiplie par 1,5 cette liste d'ingrédients tirée d'un magazine. »

Le chemin ordinaire va de `list_filters` à `search_recipes`, puis à `get_recipe`
sur le chemin que porte une ligne.

## Les outils

| Outil               | Ce qu'il fait                                                      |
| ------------------- | ------------------------------------------------------------------ |
| `list_filters`      | Lit les valeurs que prend chaque axe du site.                      |
| `search_recipes`    | Trouve des recettes, resserrées selon ces axes.                    |
| `get_recipe`        | Lit une recette, adaptée ou dans d'autres unités sur demande.      |
| `scale_ingredients` | Adapte n'importe quelle liste d'ingrédients, sans requête au site. |

**Appelez `list_filters` avant de resserrer une recherche.** Le site accepte
n'importe quelle valeur sur un axe et répond à celle qu'il ne connaît pas par un
total de zéro, donc une orthographe devinée revient comme une absence assurée au
lieu d'un refus.

### `list_filters`

Lit les axes selon lesquels le site resserre, et les valeurs que chacun prend.

| Argument | Type                      | Requis | Ce qu'il fait                                                        |
| -------- | ------------------------- | ------ | -------------------------------------------------------------------- |
| `query`  | chaîne, 1 à 80 caractères | non    | Compte les valeurs dans une recherche plutôt que sur toute la liste. |

**En retour :** `filters`, une entrée par axe portant `name` et `label` dans les
termes du site, `argument`, qui nomme l'argument que `search_recipes` prend pour
lui, et `options` avec chaque `value`, son `label` et son `count`. Un `count` que
le site n'a pas publié vaut `null`. `option_count` dit combien d'options sont
listées ici, ce qui est moins que ce que le site accepte : les valeurs rendues
sont les plus fréquentes, et une option absente de la liste reste utilisable. Les
comptes sont mesurés dans une portée, donc passer `query` compte dans une
recherche et l'omettre compte sur toute la liste ; les deux répondent à des
questions différentes.

### `search_recipes`

Cherche des recettes, resserrées selon les axes du site et selon des
restrictions que ce serveur applique aux lignes qu'il a lues.

| Argument            | Type                                                               | Requis | Ce qu'il fait                                 |
| ------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------------- |
| `query`             | chaîne, 1 à 80 caractères                                          | oui    | Un plat, un ingrédient, une technique.        |
| `limit`             | entier, 1 à 30, défaut `30`                                        | non    | Lignes à servir.                              |
| `page`              | entier, 1 à 334, défaut `1`                                        | non    | Quelle page de lignes.                        |
| `sort`              | `relevant`, `rating`, `published` ou `quickest`, défaut `relevant` | non    | L'ordre dans lequel le site range les lignes. |
| `diet`              | chaîne, 1 à 60 caractères                                          | non    | Une valeur publiée par `list_filters`.        |
| `cuisine`           | chaîne, 1 à 60 caractères                                          | non    | Une valeur publiée par `list_filters`.        |
| `meal_type`         | chaîne, 1 à 60 caractères                                          | non    | Une valeur publiée par `list_filters`.        |
| `difficulty`        | chaîne, 1 à 60 caractères                                          | non    | Une valeur publiée par `list_filters`.        |
| `max_total_minutes` | entier, 1 à 1440                                                   | non    | La recette entière, en minutes.               |
| `max_calories`      | entier, 1 à 10000                                                  | non    | Calories par portion.                         |
| `min_servings`      | entier, 1 à 50                                                     | non    | Au moins ce nombre de portions.               |
| `min_rating`        | nombre, 1 à 5                                                      | non    | Au moins ce nombre d'étoiles.                 |
| `exclude_premium`   | booléen                                                            | non    | Retire les lignes réservées aux abonnés.      |

**En retour :** des lignes portant `id`, que `get_recipe` reprend ; `title` ;
`url` ; `image_url` ; et `rating`, `null` là où le site n'en a publié aucune.
Viennent aussi `result_count`, `rows_seen` pour les lignes servies par le site
avant tout écartement, et `total_available`. Un total marqué `total_is_ceiling`
se pose sur le plus grand nombre de lignes qu'une recherche servira, donc il
énonce un plancher plutôt qu'un compte. `restrictions_lifted` nomme ce qui a été
écarté quand le resserrement faisait échouer la recherche, et `premium_dropped`
compte les lignes d'abonnés retirées. Le site n'offre aucune restriction sur les
lignes d'abonnés, donc `exclude_premium` les retire une fois la page arrivée :
une page revient alors plus courte que la limite demandée, et une page courte
n'est pas la fin des résultats.

### `get_recipe`

Lit une recette, adaptée à un nombre de parts et dans le système d'unités
demandé.

| Argument      | Type                       | Requis | Ce qu'il fait                                          |
| ------------- | -------------------------- | ------ | ------------------------------------------------------ |
| `id`          | chaîne, 1 à 200 caractères | oui    | Le chemin de la page, tel qu'une ligne le porte.       |
| `servings`    | entier, 1 à 100            | non    | Adapte les ingrédients à ce nombre de parts.           |
| `unit_system` | `metric` ou `us`           | non    | Les unités dans lesquelles les quantités sont écrites. |

**En retour :** `title`, `url`, `premium`, `yield_text` dans les termes du site
comme `Serves 4 - 6`, `yield_count`, `prep_minutes`, `cook_minutes`,
`total_minutes`, `difficulty`, `diets`, `author`, `rating`, `rating_count`,
`description`, `ingredients`, `steps`, `nutrition` avec `nutrition_per` qui nomme
la portion décrite, et `unit_system`. Un chiffre que la page n'indique pas vaut
`null`. **Une recette réservée aux abonnés revient avec `premium` à vrai, sans
ingrédients et sans étapes :** renvoyez le lecteur vers sa page au lieu de les
reconstituer. Chaque ingrédient porte `scaling`, valant `scaled`, `rounded` ou
`unscaled`.

### `scale_ingredients`

Applique la même arithmétique à n'importe quelle liste d'ingrédients, sans
requête au site.

| Argument        | Type                                           | Requis        | Ce qu'il fait                                      |
| --------------- | ---------------------------------------------- | ------------- | -------------------------------------------------- |
| `ingredients`   | tableau de 1 à 100 chaînes, 1 à 300 caractères | oui           | Les lignes à adapter, comme une recette les écrit. |
| `factor`        | nombre, 0.001 à 1000                           | l'un des deux | Ce par quoi multiplier chaque quantité.            |
| `from_servings` | entier, 1 à 100                                | l'un des deux | Le nombre de convives de la liste d'origine.       |
| `to_servings`   | entier, 1 à 100                                | l'un des deux | Le nombre de convives voulu.                       |

Passez `factor`, ou le couple `from_servings` et `to_servings`.

**En retour :** les lignes adaptées dans la forme que rend `get_recipe`, chacune
avec son `original`, son `text`, son `amount`, `amount_max` et `unit`, et son
`scaling`.

## L'adaptation des quantités

Une quantité est exprimée dans l'unité qui lui convient. Après adaptation, une
ligne peut donc apparaître dans une autre unité que celle de la recette : 200 g
multipliés par vingt donnent `4 kg`, et 2 g divisés par dix donnent `200 mg`.

La finesse à laquelle un ingrédient se coupe dépend de sa nature. Un pain se
coupe en deux, en trois ou en quatre ; un oeuf ne se partage pas. Une quantité
qui tombe entre les deux est donc arrondie, et la recette adaptée s'écarte alors
un peu des proportions de l'originale. La ligne porte `rounded`, et sa note dit
ce qui a été fait.

Les chiffres sont l'arithmétique de ce serveur, donc dites qu'ils ont été
recalculés quand vous les montrez. Une recette dont la page n'indique aucun
nombre de parts ne peut pas être portée à un nombre de convives, et la réponse le
dit.

## Configuration

Chaque variable est facultative. Elles se posent dans le bloc `env` de la
configuration du client.

| Variable                | Défaut               | Ce qu'elle fait                                                                   |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `BGF_USER_AGENT`        | l'identité du projet | Nomme votre application auprès du site, avec une adresse où joindre une personne. |
| `BGF_MIN_INTERVAL_MS`   | `1500`               | Écart entre deux requêtes, de 1000 à 60000.                                       |
| `BGF_TIMEOUT_MS`        | `20000`              | Délai d'une requête, de 1000 à 120000.                                            |
| `BGF_MAX_RETRIES`       | `3`                  | Tentatives après un échec passager, de 0 à 8.                                     |
| `BGF_CACHE_TTL_MS`      | `900000`             | Durée pendant laquelle une page reste en mémoire, de 0 à 86400000.                |
| `BGF_CACHE_MAX_ENTRIES` | `200`                | Pages gardées en mémoire à la fois, de 1 à 5000.                                  |
| `BGF_LOG_LEVEL`         | `error`              | `silent`, `error`, `info` ou `debug`, écrit sur la sortie d'erreur.               |

Une valeur hors de sa plage retombe sur le défaut, et la raison est écrite sur la
sortie d'erreur.

## Erreurs

Chaque échec porte un des six codes, un message, et quand cela aide une
indication du geste suivant.

| Code            | Ce qui s'est passé                                 | Que faire                                                                                         |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `not_found`     | Le site a répondu, et n'a pas cette recette.       | Vérifiez le chemin avec `search_recipes`.                                                         |
| `invalid_input` | Les arguments ont été refusés avant toute requête. | Lisez le message, qui nomme l'argument.                                                           |
| `rate_limited`  | Le site demande à ce client de ralentir.           | Attendez les secondes indiquées et rappelez avec les mêmes arguments. La recette est toujours là. |
| `parse_failure` | La page a chargé et le contenu attendu est absent. | Signalez-le sur [le suivi d'incidents](https://github.com/smeet666/mcp-bbc-goodfood/issues).      |
| `network_error` | La requête n'a pas abouti.                         | Réessayez sous peu.                                                                               |
| `timeout`       | La requête a dépassé son délai.                    | Augmentez `BGF_TIMEOUT_MS`, ou demandez moins de lignes.                                          |

## Comme bibliothèque

La couche qui lit le site est publiée seule, avec son rythme, son cache et ses
erreurs, sans protocole attaché.

```ts
import { BbcGoodFoodClient } from "mcp-bbc-goodfood/client";

const client = new BbcGoodFoodClient();
const { data, cached } = await client.searchRecipes({ query: "lasagne" });
console.log(data.rows.length, cached);
```

`listFilters`, `searchRecipes` et `getRecipe` répondent chacun `{ data, cached }`,
et lèvent une erreur portant un des six codes. Le plancher entre deux requêtes
tient également ici.

## Rythme et attribution

Les requêtes partent une à une avec au moins une seconde et demie entre elles, et
le plancher d'une seconde tient quelle que soit la configuration. Le `User-Agent`
se termine toujours par l'identité du projet et une adresse où joindre une
personne.

Chaque résultat porte l'adresse de la page d'où il a été lu, et `source` nomme le
site. Les recettes appartiennent à BBC Good Food et aux cuisiniers qui les ont
écrites.

Ce MCP est un projet non officiel, sans affiliation à BBC Good Food.

## Confidentialité

Ce serveur ne collecte rien sur vous et n'envoie rien à son auteur. Il tourne sur
votre machine, ne joint que `www.bbcgoodfood.com`, garde ses réponses en mémoire le temps qu'il
tourne, et n'écrit rien sur le disque. [PRIVACY.md](PRIVACY.md) dit ce qu'une
requête emporte et quels réglages changent cela.

## Développement

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Les tests s'exécutent sur des fixtures engendrées et n'émettent aucune requête.
La suite en direct, `npm run test:live`, émet une requête par route et tourne
chaque nuit contre le site lui-même.

## Contribuer

Les anomalies, les questions et les idées ont leur place dans
[le suivi d'incidents](https://github.com/smeet666/mcp-bbc-goodfood/issues). Les
propositions de modification sont bienvenues ; ouvrir un ticket d'abord aide à
s'accorder sur la forme du changement. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, voir [LICENSE](LICENSE). Les recettes appartiennent à BBC Good Food et à
leurs auteurs.
