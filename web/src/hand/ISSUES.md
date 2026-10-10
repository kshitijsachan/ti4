# Hand playtest: issues outside web/src/hand

Found in the playtest sprint (game pbd21, 1512x982, Handy vs three autopilot bots). Each item belongs to another module.

## Decisions (web/src/decisions)

- `model/classify.ts` `secretHint`: `/does not believe that you can score/` also matches the bot's *public* objective
  notice ("…can score any public objectives"), so the popup can say "The game does not think you meet any of your
  secret objectives" when it said nothing about secrets. Match "any of your secret objectives" only.
- The bot's promissory-note listing ("Promissory notes in your hand… Play Political Secret / Play Strike Wing
  Ambuscade") shows up as a decision popup. The hand tray already offers those plays. It should not be a decision.
- A Trade Rider prediction prompt (`FFCC_<faction>_rider_player;<faction>_<card>`) is never surfaced as a decision.
  If the card popup is closed, the player has no board-game way to answer it.
- After a secret is scored from the hand, the status popup keeps saying "Secret objective: WAITING / Score a secret
  objective…" until "Don't score a secret" is pressed.
- The Politics "Look at the top agendas" step says "which will be shown to you in your #cards-info thread", which is
  Discord wording.
- The "Available now" pill (bottom right) and the solo-setup status toast sit on top of the open hand tray at
  1512x982 and cover the rightmost card.
- `detect/pending.ts` debug logging (`TIEDBG`, in a working-tree edit) froze the game page's main thread at one point.
  It has been removed since.

## Shim / autopilot / solo (shim/src)

- pbd21 stuck in setup after shim/bot restarts. Solo kept logging "Waiting for … to keep a secret objective", but the
  bots never re-answered their keep-a-secret prompts. They were unblocked by pressing their discard buttons over the
  raw protocol.
- The bot's async onboarding posts in the cards thread ("Hullo there! Welcome to async!… time survey", "auto pass on
  Sabos", "end of round thoughts", "the 'when' queue is currently waiting on you") still arrive. The hand and the log
  filter them now. New games should be created with these async features off.

## Bot data the web cannot see

- The bot does not publish secret-objective progress per seat. The hand can only use its status-phase "you are
  capable of scoring…" hint, which covers only the secrets in `ListPlayerInfoService.getObjectiveThreshold`. A small
  addition to the per-seat `/hand` endpoint (`getPlayerProgressOnObjective` per unscored secret) would make "playable
  now" exact for action-phase secrets too.
