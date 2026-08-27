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
- `rows_seen` and `matched_rows` on every answer: how many rows the site served,
  and how many of them carry a word of the search. A note is added when the
  second is zero and the first is not.
