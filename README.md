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

## The tool

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
  "rows_seen": 30,
  "matched_rows": 30,
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
starts at zero the two would be indistinguishable.

**The site answers a term it holds nothing for with rows all the same.** Searching
`foobar` returns seven recipes — among them a rhubarb fizz and a flapjack bar —
matched on fragments, with nothing marking the answer as a miss. Every answer
therefore reports `rows_seen` and `matched_rows`: how many rows the site served,
and how many of them carry a word of the search. When the second is zero and the
first is not, a note says the count describes what the site offered rather than
what matched.

Two counts rather than a verdict. A legitimate search can be absent from every
title, and a reader seeing `2` of `30` judges better than a flag that judges for
them.

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

## L'outil

### `list_filters`

Liste les axes le long desquels une recherche de recettes peut être restreinte,
avec les valeurs que chacun prend et le nombre de recettes qui les portent.

| Argument | Type              | Sens                                                                                                      |
| -------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `query`  | chaîne, optionnel | Mesure les comptes à l'intérieur de cette recherche. Sans lui, ils portent sur le listing entier du site. |

Le site compte ses facettes sur les lignes qu'une recherche rend, donc les deux
répondent à des questions différentes. Dans `chicken`, `diet` annonce
`gluten-free 48`. Sur le listing entier, il annonce `gluten-free 2810`. Aucun des
deux n'est comparable à l'autre, et la réponse dit quelle portée elle a mesurée.

## Ce que les réponses refusent d'affirmer

**Les valeurs publiées sont un extrait.** Le site montre les dix valeurs les plus
fréquentes d'un axe et en accepte d'autres qu'il ne liste jamais :
`cuisine=mexican` restreint une recherche à 306 recettes sans figurer parmi les
dix. La réponse dit que la liste est un extrait au lieu de l'appeler l'ensemble
des valeurs acceptées, parce qu'un serveur qui l'appellerait ainsi refuserait des
valeurs qui marchent.

**Un total peut être un plancher.** Le site sert au plus 10 000 lignes pour une
recherche et s'arrête là. Un total qui tombe exactement sur ce nombre a été
coupé, donc il énonce un plancher plutôt qu'un compte, et `total_is_ceiling` le
dit.

**Un compte que le site n'a pas publié vaut `null`, jamais `0`.** Sur une échelle
qui commence à zéro, les deux seraient indiscernables.

**Le site répond quand même à un terme dont il n'a rien.** Chercher `foobar` rend
sept recettes, dont un cocktail à la rhubarbe et une barre de flapjack,
rapprochées par fragments, sans que rien ne marque la réponse comme un échec.
Chaque réponse rend donc `rows_seen` et `matched_rows` : combien de lignes le
site a servies, et combien d'entre elles portent un mot de la recherche. Quand la
seconde vaut zéro et la première non, une note dit que le compte décrit ce que le
site a proposé plutôt que ce qui correspond.

Deux comptes plutôt qu'un verdict. Une recherche légitime peut n'apparaître dans
aucun titre, et un lecteur qui voit `2` sur `30` juge mieux qu'un drapeau qui
jugerait pour lui.

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
