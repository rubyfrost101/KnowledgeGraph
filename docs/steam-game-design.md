# Steam Game Design

This document turns the Steam branch idea into a clearer game product direction.

## Core fantasy

The user uploads a PDF, then turns that book into a playable knowledge world.

Examples:

- DK history books become campaign maps with eras, events, and people as unlockable nodes
- Military books become mission trees with doctrine, equipment, and campaign routes
- Engineering books become system simulations with components, workflows, and dependencies
- Mechanical books become machine graphs with parts, processes, and failure modes
- English books become dual-language learning worlds with translation and recall support

## Recommended game loop

1. Upload a PDF
2. Parse text, images, headings, tables, and glossary entries
3. Build a chapter map and extract the main concepts
4. Turn chapters into levels and concepts into unlockable nodes
5. Let the player enter missions, answer prompts, and clear knowledge gates
6. Reward completion with new zones, knowledge cards, achievements, and translation aids
7. Revisit old chapters through spaced review so the player does not forget

## Game systems

### 1. Book as campaign

- Each PDF becomes a campaign
- Each chapter becomes a stage
- Each section becomes a node cluster
- Each term becomes a collectible card or codex entry
- Each relation becomes a traversal path or tactical link

### 2. Progression

- Clear chapters to unlock deeper layers
- Earn stars, badges, or ranks for comprehension quality
- Track mastery separately from simple completion
- Allow replay of old sections with higher difficulty for better rewards

### 3. Translation layer

- For English PDFs, show bilingual cards by default
- Keep the original sentence, a clean translation, and a short learning note
- Add quick toggles for `English only`, `Chinese only`, and `dual view`
- Use translation as a learning aid, not as a replacement for the source text

### 4. Knowledge challenges

- Multiple-choice checks for facts and vocabulary
- Short-answer recall for definitions and relations
- Matching games for terms and categories
- Sequence puzzles for process-oriented books
- Branching questions for cause/effect and comparison chapters

### 5. Discovery and collection

- Collect terms, diagrams, and key concepts into a codex
- Show hidden nodes when the player masters prerequisite topics
- Mark high-value references as `rare`, `legendary`, or `boss` knowledge
- Use achievements to make learning feel like progress, not just reading

## Different PDF types should feel different

- History books: timeline exploration, event chains, faction or era unlocks
- Military books: command trees, doctrine comparisons, strategy missions
- Engineering books: system breakdowns, dependency chains, troubleshooting quests
- Mechanical books: parts assembly, maintenance loops, failure analysis
- Language books: vocabulary raids, grammar trials, listening / reading quests

## Steam-friendly positioning

- Market it as a playable knowledge atlas or learning roguelite
- Let users import their own PDFs to generate personalized campaigns
- Bundle a few strong starter packs so the app feels fun before the user imports anything
- Build a clear demo mode that shows the magic in under one minute

## Monetization ideas

These are product ideas, not a final business model:

- Premium app purchase with a strong free demo
- Paid content packs for curated book worlds
- Translation or AI processing credits for heavy import usage
- Community-made campaign packs later, if the format becomes popular

## Design principle

The product should stay educational first and game-like second.

If a mechanic does not help the user understand, remember, or revisit the book, it should not ship.

