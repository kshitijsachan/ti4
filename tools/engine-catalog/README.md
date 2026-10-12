# engine-catalog

Regenerates `docs/engine-catalog.json` and `docs/engine-catalog.md` from the AsyncTI4 bot source. These list every
button, select and modal id prefix the engine handles, with its handler, id grammar, creation sites, target player,
game area, proposed decision kind and owning agent.

```
python3 tools/engine-catalog/generate.py --bot /home/user/asyncti4/ti4_map_generator_bot
```

It takes about a minute and needs only the Python 3 standard library. The script reads `src/main/java` and never
modifies the bot.

## Files

- `javaparse.py`: strips comments (offsets preserved), finds methods and `final String` constants, splits call
  arguments and `+` concatenations.
- `extract.py`:
  - Finds `@ButtonHandler` / `@SelectionHandler` / `@ModalHandler` values, resolving constants across classes.
  - Finds the legacy `Selection` classes.
  - Finds creation sites (`Buttons.green/red/blue/gray`, `Button.*`, `StringSelectMenu.create`, `Modal.create`, and
    any `x.factionButtonChecker() + ...` expression).
  - Renders each id expression to a `{placeholder}` pattern, inlining constants, local `String` variables,
    single-`return` helpers and one level of caller arguments.
  - Classifies where the component is sent: the send call that carries the list the button was added to, otherwise
    every send in the method, otherwise the senders of methods that return the buttons.
- `rules.py`: ordered regex rules for area, content source and decision kind, plus the agent and kind tables.
  Edit this to re-home entries.
- `render_md.py` + `notes.md`: the Markdown page. Prose goes in `notes.md`; the tables are generated.

## Limits

These are heuristics, not a Java compiler:

- Ids built from parameters more than one call away stay `{prefix}`-style and unmatched. They are listed in
  `unmatchedCreationSites`.
- Placeholder names are guessed from variable and method names.
- Area and kind are regex guesses. `kindRule` and `areaMatchedOn` show which rule fired.
