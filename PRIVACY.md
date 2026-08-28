# Privacy

This server collects nothing about you, and sends nothing to its author.

_[Version française](#confidentialité)_

---

## What this server is

`mcp-bbc-goodfood` is a read-only client for
[BBC Good Food](https://www.bbcgoodfood.com). It runs on your own machine, as a
process your MCP host starts, and it speaks over stdio. It listens on no port.

It needs no API key and no account, so there is no credential for it to hold and
none for it to send.

## What leaves your machine, and where it goes

**One host is contacted: `www.bbcgoodfood.com`.** Nothing else. Every request is
a page or a search route that a browser reads without signing in.

What such a request carries:

| What                          | Why it is there                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The search or the recipe path | It is the question being asked. A search for `chicken` reaches the site as `chicken`.                                   |
| A `User-Agent`                | `mcp-bbc-goodfood/<version> (+<the repository address>)`, so the site can reach a person about the traffic it receives. |
| Your IP address               | Sent by your network to any host you contact, as with any web request.                                                  |

Your requests reach BBC Good Food. What that site does with them is governed by
[its own privacy policy](https://www.bbcgoodfood.com/privacy-policy), which this
project does not control.

## What is kept, and for how long

**Answers are held in memory only, and only while the server runs.** The cache is
a table in the process: it holds what was read so that reading the same page
twice costs the site one request instead of two. Closing the server empties it.

**Nothing is written to disk.** The server creates no file, no database and no
log file.

## What is never collected

- No analytics, no telemetry, no usage counter.
- Nothing is sent to the author of this project or to any third party.
- No account, no profile, no identifier is created for you.
- Your questions are not stored, forwarded, or used to train anything.

## Logs

The server writes diagnostics to **stderr**, where your MCP host decides what
becomes of them. `BGF_LOG_LEVEL` governs how much is written and defaults to
`error`. These lines stay on your machine.

## The settings that change any of this

| Variable           | What it changes                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `BGF_USER_AGENT`   | Adds your own identifier in front of this project's, which stays appended so the site can always reach a person. |
| `BGF_CACHE_TTL_MS` | How long an answer is held in memory. `0` turns the cache off.                                                   |
| `BGF_LOG_LEVEL`    | How much is written to stderr.                                                                                   |

## Children

This server is a tool for developers and it is not directed at children.

## Changes

A change to this policy travels in a release, and the changelog names it.

## Contact

Open an issue on
[the repository](https://github.com/smeet666/mcp-bbc-goodfood/issues). For
something exploitable, follow [SECURITY.md](./SECURITY.md) instead.

---

# Confidentialité

Ce serveur ne collecte rien sur vous et n'envoie rien à son auteur.

## Ce qu'est ce serveur

`mcp-bbc-goodfood` est un client en lecture seule pour
[BBC Good Food](https://www.bbcgoodfood.com). Il tourne sur votre machine, comme
un processus que votre hôte MCP démarre, et il parle en stdio. Il n'écoute sur
aucun port.

Il ne demande ni clé d'API ni compte, donc il ne détient aucun identifiant et
n'en envoie aucun.

## Ce qui quitte votre machine, et où cela va

**Un seul hôte est joint : `www.bbcgoodfood.com`.** Rien d'autre. Chaque requête
porte sur une page ou une route de recherche qu'un navigateur lit sans se
connecter.

Ce qu'une telle requête emporte :

| Quoi                                    | Pourquoi                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| La recherche ou le chemin de la recette | C'est la question posée. Une recherche sur `poulet` atteint le site telle quelle.                                                 |
| Un `User-Agent`                         | `mcp-bbc-goodfood/<version> (+<adresse du dépôt>)`, pour que le site puisse joindre une personne au sujet du trafic qu'il reçoit. |
| Votre adresse IP                        | Transmise par votre réseau à tout hôte que vous joignez, comme pour n'importe quelle requête web.                                 |

Vos requêtes atteignent BBC Good Food. Ce que ce site en fait relève de
[sa propre politique de confidentialité](https://www.bbcgoodfood.com/privacy-policy),
que ce projet ne contrôle pas.

## Ce qui est conservé, et combien de temps

**Les réponses sont gardées en mémoire seulement, et seulement pendant que le
serveur tourne.** Le cache est une table dans le processus : il retient ce qui a
été lu pour que lire deux fois la même page coûte une requête au site plutôt que
deux. Fermer le serveur le vide.

**Rien n'est écrit sur le disque.** Le serveur ne crée aucun fichier, aucune base
et aucun journal.

## Ce qui n'est jamais collecté

- Aucune analyse d'audience, aucune télémétrie, aucun compteur d'usage.
- Rien n'est envoyé à l'auteur de ce projet ni à un tiers.
- Aucun compte, aucun profil, aucun identifiant n'est créé pour vous.
- Vos questions ne sont ni stockées, ni transmises, ni utilisées pour entraîner
  quoi que ce soit.

## Les journaux

Le serveur écrit ses diagnostics sur **stderr**, où votre hôte MCP décide de ce
qu'ils deviennent. `BGF_LOG_LEVEL` règle leur quantité et vaut `error` par
défaut. Ces lignes restent sur votre machine.

## Les réglages qui changent tout cela

| Variable           | Ce qu'elle change                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `BGF_USER_AGENT`   | Ajoute votre identifiant devant celui du projet, qui reste accolé pour que le site puisse toujours joindre une personne. |
| `BGF_CACHE_TTL_MS` | Combien de temps une réponse est gardée en mémoire. `0` éteint le cache.                                                 |
| `BGF_LOG_LEVEL`    | La quantité écrite sur stderr.                                                                                           |

## Les enfants

Ce serveur est un outil pour développeurs et ne s'adresse pas aux enfants.

## Les évolutions

Une modification de cette politique voyage dans une version, et le changelog la
nomme.

## Contact

Ouvrez une issue sur
[le dépôt](https://github.com/smeet666/mcp-bbc-goodfood/issues). Pour quelque
chose d'exploitable, suivez plutôt [SECURITY.md](./SECURITY.md).
