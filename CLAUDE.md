# CLAUDE.md

## Engineering Standards (Non-Negotiable)

These instructions apply to all code and documentation in this repository.
If a change does not satisfy these standards, it is not complete.

## 1) Function Design and Responsibility

- Every function must have exactly one responsibility.
- A function must do one clearly defined job and do it well.
- If a function starts handling parsing, validation, transformation, and output formatting together, split it into helpers.
- Prefer composition of small functions over nested, monolithic logic.
- Keep functions short and readable. Target concise functions; extract helpers as soon as branching or nesting grows.

## 2) Mandatory Docstrings

- Every function must include a docstring.
- The docstring must explicitly describe:
  - what the function does
  - its inputs (name, type/shape, constraints)
  - its output (type/shape and meaning)
  - raised exceptions or failure modes (when relevant)
- Docstrings must be written and updated together with code changes. No stale documentation.

## 3) Clean Code Rules

- Use meaningful and unambiguous names for variables, functions, classes, and modules.
- Eliminate magic numbers by defining named constants with clear intent.
- Remove dead code immediately (unused variables, unreachable branches, commented-out legacy blocks).
- Prefer explicitness over cleverness; optimize for maintainability.
- Keep side effects isolated and obvious (I/O, network, filesystem, DB writes).
- Avoid deep nesting. Use guard clauses and helper extraction.
- Do not duplicate logic. Reuse shared helpers for repeated behavior.

## 4) Error Handling and Contracts

- Validate inputs at system boundaries (files, APIs, user input, external data).
- Fail fast with clear, actionable error messages.
- Do not silently swallow exceptions.
- Define and respect clear contracts between modules (inputs, outputs, invariants).

## 5) Testing Requirements (Mandatory)

- Unit tests are required for all functions.
- "Happy path only" tests are not sufficient.
- For each function, tests must cover at least:
  - expected behavior
  - invalid input handling
  - edge conditions
  - deterministic output expectations
- Tests must be readable, deterministic, and isolated.
- Keep test names descriptive: they should state behavior and expected result.

## 6) Project Documentation (README.md Required)

A root `README.md` must always be present and up to date.

It must include:

- What the application does (purpose and scope)
- How to install dependencies
- How to run the app
- How to run the test suite
- Codebase structure, module by module
- Processing pipeline explained step-by-step:
  - ingestion
  - extraction
  - classification
  - income
  - UI

If architecture or flow changes, update the README in the same change set.

## 7) Definition of Done

A task is complete only if all conditions below are met:

- Code follows single-responsibility function design
- All functions include complete docstrings
- No magic numbers, dead code, or unclear naming
- Unit tests exist and pass for all touched functions
- Root README reflects the current implementation and processing flow
- New behavior is understandable from both code and docs without tribal knowledge

## 8) Review Checklist

Before considering a change ready, verify:

- Is each function focused on exactly one thing?
- Are functions short enough to read in one pass?
- Are docstrings complete and accurate?
- Are constants named and magic numbers removed?
- Is duplicate logic extracted?
- Are tests complete for each function?
- Is `README.md` updated for behavior or structure changes?

If any answer is "no", continue iterating.
