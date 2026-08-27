# mcp-bbc-goodfood

[![CI](https://github.com/smeet666/mcp-bbc-goodfood/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-bbc-goodfood/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-bbc-goodfood)](https://www.npmjs.com/package/mcp-bbc-goodfood)
[![licence MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

An MCP server that reads recipes on [BBC Good Food](https://www.bbcgoodfood.com).
Read-only, no API key, no account.

_[Version française](#mcp-bbc-goodfood-français)_

---

## Why it exists

BBC Good Food accepts any value on a search facet, and answers one it does not
know with a total of zero. Ask for `glutenfree` instead of `gluten-free` and the
site says nothing matches, with the same confidence it says 48 recipes match the
correct spelling. A model that guesses a spelling gets a confident absence
instead of a refusal.

This server publishes the vocabulary, so the question can be asked properly.

## The tools

### `list_filters`

Lists the axes a recipe search can be narrowed along, with the values each one
takes and how many recipes carry them.

| Argument | Type             | Meaning                                                                           |
| -------- | ---------------- | --------------------------------------------------------------------------------- |
| `query`  | string, optional | Measure the counts inside this search. Leave it out for the site's whole listing. |

The site counts its facets over the rows a search returns, so the two answer
different questions. Within `chicken`, `diet` reports `gluten-free 48`. Across
the whole listing it reports `gluten-free 2810`. Neither is comparable to the
other, and the answer says which scope it measured.

```json
{
  "query": "chicken",
  "filters": [
    {
      "name": "diet",
      "label": "Diets",
      "options": [{ "value": "gluten-free", "label": "Gluten-free", "count": 48 }],
      "option_count": 10
    }
  ],
  "filter_count": 9,
  "total_available": 363,
  "total_is_ceiling": false,
  "source": "BBC Good Food",
  "notes": ["…"]
}
```

### `search_recipes`

Searches recipes and returns a listing. Every row carries the path of its page,
which is what `get_recipe` reads.

| Argument                      | Type              | Meaning                                              |
| ----------------------------- | ----------------- | ---------------------------------------------------- |
| `query`                       | string            | A dish, an ingredient, a technique.                  |
| `limit`, `page`               | integer, optional | Rows per page and which page. Defaults to 30 and 1.  |
| `sort`                        | string, optional  | How the site orders the listing.                     |
| `diet`, `cuisine`, `meal_type`, `difficulty` | string, optional | A value `list_filters` publishes.     |
| `max_total_minutes`, `max_calories`, `min_servings`, `min_rating` | number, optional | A bound on the recipe. |
| `exclude_premium`             | boolean, optional | Leave out what sits behind the site's subscription.  |

The site accepts any value on a facet and answers one it does not know with a
total of zero, so a guessed spelling comes back as a confident absence rather
than as a refusal. Call `list_filters` first.

### `get_recipe`

Reads one recipe: its ingredients, its steps, its times, its rating and its
nutrition.

| Argument   | Type              | Meaning                                                     |
| ---------- | ----------------- | ----------------------------------------------------------- |
| `id`       | string            | The page's own path, as a `search_recipes` row carries it.  |
| `servings` | integer, optional | Put the ingredients to this many people.                    |

A recipe behind the site's subscription comes back with everything except its
ingredients and its steps, and says so. The page carries them, which is exactly
why the rule exists: reading past a wall the site put in front of its own
readers would make this server the way around it.

### `scale_ingredients`

Puts a list of ingredient lines to a different number of people, without reading
anything on the site.

| Argument                        | Type              | Meaning                                              |
| ------------------------------- | ----------------- | ---------------------------------------------------- |
| `ingredients`                   | string[]          | The lines to scale, as a recipe writes them.         |
| `factor`                        | number, optional  | What to multiply every quantity by.                  |
| `from_servings`, `to_servings`  | integer, optional | The two ends of the change, instead of a factor.     |

```json
{
  "factor": 0.5,
  "ingredients": [
    { "text": "100 g plain flour", "original": "200g plain flour", "scaling": "scaled",
      "amount": 100, "amount_max": null, "unit": "g" },
    { "text": "2 eggs", "original": "3 eggs", "scaling": "rounded",
      "amount": 2, "amount_max": null, "unit": null },
    { "text": "salt and pepper", "original": "salt and pepper", "scaling": "unscaled",
      "amount": null, "amount_max": null, "unit": null }
  ],
  "scaled_count": 1,
  "rounded_count": 1,
  "unscaled_count": 1,
  "source": "BBC Good Food",
  "notes": ["…"]
}
```

## What the answers refuse to overstate

**The published values are a shortlist.** The site shows the ten most frequent
values on an axis and accepts others it never lists: `cuisine=mexican` narrows a
search to 306 recipes without appearing among the ten. The answer says the list
is an excerpt rather than calling it the set of accepted values, because a
server that called it that would refuse values that work.

**A total can be a floor.** The site serves at most 10 000 rows for one search
and stops there. A total landing exactly on that figure was cut, so it states a
floor rather than a count, and `total_is_ceiling` says so.

**A count the site published nothing for is `null`, never `0`.** On a scale that
starts at zero the two would be indistinguishable. A rating runs from one star to
five, so a recipe nobody has rated comes back as `null` rather than as a recipe
rated zero.

**A recalculated quantity says that it was recalculated.** The figures a scaled
list carries are this server's arithmetic and not the site's, and every line says
under `scaling` whether the arithmetic landed exactly or whether the figure moved
to stay usable in a kitchen. Three eggs halved come back as two, because half an
egg is not an amount a kitchen measures out; a cook told `2` deserves to know
which of the two happened.

**A recipe whose page states no servings cannot be put to a number of people.**
The `servings` argument is then left without effect and a note says so, because
the multiplication would have to start from a figure the site never wrote.

## Install

```bash
npx mcp-bbc-goodfood
```

### Claude Code

```bash
claude mcp add bbc-goodfood -- npx -y mcp-bbc-goodfood
```

### Any MCP client

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

### Container

```bash
docker build -t mcp-bbc-goodfood .
docker run -i --rm mcp-bbc-goodfood
```

The container needs to reach `www.bbcgoodfood.com` and nothing else. It takes no
credentials, because there are none to take.

## Settings

Every setting is an environment variable, and none is required. A value outside
its range is refused with a line on stderr and the default stands: a setting that
cannot take effect says so rather than being quietly clamped.

| Variable                | Default | Range                                                                              |
| ----------------------- | ------- | ---------------------------------------------------------------------------------- |
| `BGF_USER_AGENT`        | —       | Your own identifier. This project's stays appended, so the site can reach a human. |
| `BGF_MIN_INTERVAL_MS`   | 1500    | 1000 to 60000                                                                      |
| `BGF_TIMEOUT_MS`        | 20000   | 1000 to 120000                                                                     |
| `BGF_MAX_RETRIES`       | 3       | 0 to 8                                                                             |
| `BGF_CACHE_TTL_MS`      | 900000  | 0 to 86400000, 0 turns storage off                                                 |
| `BGF_CACHE_MAX_ENTRIES` | 200     | 1 to 5000                                                                          |
| `BGF_LOG_LEVEL`         | `error` | `silent`, `error`, `info`, `debug`                                                 |

The pacing floor cannot be lowered from outside. The site is free to read and
publishes no crawl delay, which is a reason to be careful rather than a licence
to be fast.

## As a library

The reading layer is published on its own, with its pacing, its storage and its
error vocabulary and no protocol attached:

```ts
import { GoodFoodClient } from "mcp-bbc-goodfood/client";
```

## Errors

Six codes and no more. A caller branches on the code that opens the message.

| Code            | What it means                                                                           |
| --------------- | --------------------------------------------------------------------------------------- |
| `not_found`     | The site holds nothing at that address                                                  |
| `invalid_input` | The arguments could not produce a request                                               |
| `rate_limited`  | The site asked this client to slow down. It says nothing about whether anything matched |
| `parse_failure` | An answer arrived in a shape this server cannot read                                    |
| `network_error` | The request could not be completed                                                      |
| `timeout`       | No answer arrived within the deadline                                                   |

## Attribution

Recipes, titles and counts belong to BBC Good Food. Every answer carries the
source, and a listing shown to a reader should credit the site and link the page.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Tests come first, coverage has a floor of
100%, and the rule everything follows is that the server never says anything the
data does not carry.

Licensed under [MIT](LICENSE).

---

# mcp-bbc-goodfood (français)

Un serveur MCP qui lit les recettes de [BBC Good Food](https://www.bbcgoodfood.com).
En lecture seule, sans clé d'API et sans compte.

## Pourquoi il existe

BBC Good Food accepte n'importe quelle valeur sur une facette de recherche, et
répond à une valeur qu'il ne connaît pas par un total de zéro. Demandez
`glutenfree` au lieu de `gluten-free` et le site répond que rien ne correspond,
avec l'assurance qu'il met à dire que 48 recettes correspondent à la bonne
orthographe. Un modèle qui devine une orthographe reçoit une absence confiante
plutôt qu'un refus.

Ce serveur publie le vocabulaire, pour que la question soit posable.

## Les outils

### `list_filters`

Publie les axes le long desquels une recherche de recettes se resserre, avec les
valeurs que chacun prend et le nombre de recettes qui les portent.

| Argument | Type                | Sens                                                                                    |
| -------- | ------------------- | --------------------------------------------------------------------------------------- |
| `query`  | chaîne, facultative | Mesure les décomptes à l'intérieur de cette recherche. Sans elle, sur tout le catalogue. |

Le site compte ses facettes sur les lignes que la recherche rend, si bien que les
deux répondent à deux questions différentes. Dans `chicken`, `diet` annonce
`gluten-free 48`. Sur tout le catalogue, il annonce `gluten-free 2810`. Aucun des
deux ne se compare à l'autre, et la réponse dit dans quelle étendue elle a mesuré.

```json
{
  "query": "chicken",
  "filters": [
    {
      "name": "diet",
      "label": "Diets",
      "options": [{ "value": "gluten-free", "label": "Gluten-free", "count": 48 }],
      "option_count": 10
    }
  ],
  "filter_count": 9,
  "total_available": 363,
  "total_is_ceiling": false,
  "source": "BBC Good Food",
  "notes": ["…"]
}
```

### `search_recipes`

Cherche des recettes et rend une liste. Chaque ligne porte le chemin de sa page,
qui est ce que `get_recipe` lit.

| Argument                      | Type                | Sens                                                        |
| ----------------------------- | ------------------- | ----------------------------------------------------------- |
| `query`                       | chaîne              | Un plat, un ingrédient, une technique.                      |
| `limit`, `page`               | entier, facultatif  | Lignes par page et quelle page. Par défaut 30 et 1.         |
| `sort`                        | chaîne, facultative | L'ordre dans lequel le site range la liste.                 |
| `diet`, `cuisine`, `meal_type`, `difficulty` | chaîne, facultative | Une valeur que `list_filters` publie.       |
| `max_total_minutes`, `max_calories`, `min_servings`, `min_rating` | nombre, facultatif | Une borne sur la recette. |
| `exclude_premium`             | booléen, facultatif | Laisse de côté ce qui est derrière l'abonnement du site.    |

Le site accepte n'importe quelle valeur sur une facette et répond à une valeur
qu'il ne connaît pas par un total de zéro : une orthographe devinée revient comme
une absence assurée et non comme un refus. Appelle `list_filters` d'abord.

### `get_recipe`

Lit une recette : ses ingrédients, ses étapes, ses temps, sa note et ses valeurs
nutritionnelles.

| Argument   | Type               | Sens                                                            |
| ---------- | ------------------ | --------------------------------------------------------------- |
| `id`       | chaîne             | Le chemin de la page, tel qu'une ligne de `search_recipes` le porte. |
| `servings` | entier, facultatif | Remet les ingrédients à ce nombre de parts.                     |

Une recette derrière l'abonnement du site revient avec tout sauf ses ingrédients
et ses étapes, et le dit. La page les porte, et c'est exactement pourquoi la
règle existe : lire au-delà d'un mur que le site a dressé devant ses propres
lecteurs ferait de ce serveur le moyen de le contourner.

### `scale_ingredients`

Remet une liste de lignes d'ingrédients à un autre nombre de personnes, sans rien
lire sur le site.

| Argument                       | Type               | Sens                                                     |
| ------------------------------ | ------------------ | -------------------------------------------------------- |
| `ingredients`                  | chaîne[]           | Les lignes à remettre à l'échelle, telles qu'une recette les écrit. |
| `factor`                       | nombre, facultatif | Ce par quoi multiplier chaque quantité.                  |
| `from_servings`, `to_servings` | entier, facultatif | Les deux bouts du changement, à la place d'un facteur.   |

```json
{
  "factor": 0.5,
  "ingredients": [
    { "text": "100 g plain flour", "original": "200g plain flour", "scaling": "scaled",
      "amount": 100, "amount_max": null, "unit": "g" },
    { "text": "2 eggs", "original": "3 eggs", "scaling": "rounded",
      "amount": 2, "amount_max": null, "unit": null },
    { "text": "salt and pepper", "original": "salt and pepper", "scaling": "unscaled",
      "amount": null, "amount_max": null, "unit": null }
  ],
  "scaled_count": 1,
  "rounded_count": 1,
  "unscaled_count": 1,
  "source": "BBC Good Food",
  "notes": ["…"]
}
```

## Ce que les réponses refusent d'affirmer

**Les valeurs publiées sont un extrait.** Le site montre les dix valeurs les plus
fréquentes d'un axe et en accepte d'autres qu'il ne liste jamais : `cuisine=mexican`
resserre une recherche à 306 recettes sans figurer parmi les dix. La réponse dit
que la liste est un extrait plutôt que de l'appeler l'ensemble des valeurs
acceptées, parce qu'un serveur qui l'appellerait ainsi refuserait des valeurs qui
fonctionnent.

**Un total peut être un plancher.** Le site sert au plus 10 000 lignes pour une
recherche et s'arrête là. Un total qui tombe exactement sur ce chiffre a été
coupé : il énonce un plancher et non un compte, et `total_is_ceiling` le dit.

**Un décompte que le site n'a pas publié vaut `null`, jamais `0`.** Sur une
échelle qui commence à zéro, les deux seraient indiscernables. Une note va d'une
étoile à cinq, donc une recette que personne n'a notée revient à `null` plutôt
qu'en recette notée zéro.

**Une quantité recalculée dit qu'elle a été recalculée.** Les chiffres d'une
liste remise à l'échelle sont l'arithmétique de ce serveur et non celle du site,
et chaque ligne dit sous `scaling` si le calcul est tombé juste ou si le chiffre
a bougé pour rester utilisable en cuisine. Trois œufs divisés par deux reviennent
à deux, parce qu'un demi-œuf n'est pas une quantité qu'une cuisine mesure ; un
cuisinier à qui l'on annonce `2` mérite de savoir lequel des deux s'est produit.

**Une recette dont la page n'énonce aucun nombre de parts ne peut pas être remise
à un nombre de personnes.** L'argument `servings` reste alors sans effet et une
note le dit, parce que la multiplication devrait partir d'un chiffre que le site
n'a jamais écrit.

## Installation

```bash
npx mcp-bbc-goodfood
```

### Claude Code

```bash
claude mcp add bbc-goodfood -- npx -y mcp-bbc-goodfood
```

### N'importe quel client MCP

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

### Conteneur

```bash
docker build -t mcp-bbc-goodfood .
docker run -i --rm mcp-bbc-goodfood
```

Le conteneur doit joindre `www.bbcgoodfood.com` et rien d'autre. Il ne prend
aucun identifiant, puisqu'il n'y en a aucun à prendre.

## Réglages

Chaque réglage est une variable d'environnement, et aucune n'est obligatoire. Une
valeur hors bornes est refusée par une ligne sur stderr et le défaut tient : un
réglage qui ne peut pas prendre effet le dit, plutôt que d'être borné en silence.

| Variable                | Défaut  | Bornes                                                                                         |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `BGF_USER_AGENT`        | —       | Votre identifiant. Celui du projet reste ajouté, pour que le site puisse joindre une personne. |
| `BGF_MIN_INTERVAL_MS`   | 1500    | 1000 à 60000                                                                                   |
| `BGF_TIMEOUT_MS`        | 20000   | 1000 à 120000                                                                                  |
| `BGF_MAX_RETRIES`       | 3       | 0 à 8                                                                                          |
| `BGF_CACHE_TTL_MS`      | 900000  | 0 à 86400000, 0 éteint le stockage                                                             |
| `BGF_CACHE_MAX_ENTRIES` | 200     | 1 à 5000                                                                                       |
| `BGF_LOG_LEVEL`         | `error` | `silent`, `error`, `info`, `debug`                                                             |

Le plancher du rythme ne peut pas être abaissé de l'extérieur. Le site est gratuit
à lire et ne publie aucun délai d'exploration, ce qui est une raison d'être
prudent plutôt qu'une licence d'aller vite.

## Comme bibliothèque

La couche de lecture est publiée seule, avec son rythme, son stockage et sa
taxonomie d'erreurs, sans protocole attaché :

```ts
import { GoodFoodClient } from "mcp-bbc-goodfood/client";
```

## Erreurs

Six codes et pas un de plus. Un appelant branche sur le code qui ouvre le message.

| Code            | Ce qu'il veut dire                                                     |
| --------------- | ---------------------------------------------------------------------- |
| `not_found`     | Le site n'a rien à cette adresse                                       |
| `invalid_input` | Les arguments ne pouvaient pas produire de requête                     |
| `rate_limited`  | Le site a demandé de ralentir. Cela ne dit rien sur ce qui correspond  |
| `parse_failure` | Une réponse est arrivée dans une forme que ce serveur ne sait pas lire |
| `network_error` | La requête n'a pas pu aboutir                                          |
| `timeout`       | Aucune réponse n'est arrivée dans le délai                             |

## Attribution

Les recettes, les titres et les comptes appartiennent à BBC Good Food. Chaque
réponse porte la source, et un listing montré à un lecteur doit créditer le site
et lier la page.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Les tests d'abord, un plancher de
couverture à 100 %, et la règle qui gouverne tout : le serveur ne dit jamais
quelque chose que la donnée ne porte pas.

Sous licence [MIT](LICENSE).
