// Prints what the planner would do for each player of a game right now: npx tsx tools/plan-debug.ts pbd59
import { parseBoard, distancesTo } from "../src/botplay/board.js";
import { chooseGoal, expansionOptions, dockSystems, spendable } from "../src/botplay/strategy.js";
const game = process.argv[2];
const data = await (await fetch(`http://127.0.0.1:8081/api/public/game/${game}/web-data`)).json();
const board = parseBoard(game, data);
for (const me of board.players) {
  const docks = dockSystems(board, me).map((s) => s.position);
  console.log(`${me.name} ${me.faction} ${me.color} cc=${me.tacticalCC} planets=${me.planets.join(",")} docks=${docks} res=${spendable(board, me)}`);
  for (const s of board.systems.values()) {
    const mine = s.space.get(me.faction);
    if (mine) console.log(`   ships ${s.position}: ${mine.map((u) => `${u.count}${u.unit}`).join(" ")} ccs=${s.ccs}`);
  }
  for (const g of expansionOptions(board, me).slice(0, 3)) console.log("   option:", g.why);
  console.log("   goal:", JSON.stringify(chooseGoal(board, me)).slice(0, 200));
  if (docks[0]) console.log("   dist from home:", JSON.stringify([...distancesTo(board, docks[0], me.faction, 2)]));
}
