package ti4.selfhost.engine;

import java.util.List;
import net.dv8tion.jda.api.utils.data.DataArray;
import net.dv8tion.jda.api.utils.data.DataObject;
import ti4.game.Game;
import ti4.game.Player;
import ti4.selfhost.engine.EngineModels.Decision;

/**
 * Offline C7 checks (action-card tail): action_card.step / resolve (names the card) / when_after /
 * promissory_note.resolve classification and typed values on a synthetic game. Exits 1 on failure.
 */
public class CardsTailSmoke {
    static int fails;

    static void check(boolean ok, String what) {
        System.out.println((ok ? "PASS " : "FAIL ") + what);
        if (!ok) fails++;
    }

    static DataObject msg(String id, String channel, String content, String... ids) {
        DataArray buttons = DataArray.empty();
        for (String b : ids)
            buttons.add(DataObject.empty().put("type", 2).put("style", 1).put("label", b).put("custom_id", b));
        DataArray rows = DataArray.empty().add(DataObject.empty().put("type", 1).put("components", buttons));
        return DataObject.empty()
                .put("id", id)
                .put("channel_id", channel)
                .put("flags", 0)
                .put("content", content)
                .put("components", rows);
    }

    static Decision build(Game g, DataObject m) {
        return DecisionCapture.build(g, m, DecisionCapture.controls(m), null);
    }

    public static void main(String[] args) {
        Game g = new Game();
        g.setName("pbd998");
        Player a = g.addPlayer("111", "alice");
        a.setFaction(g, "hacan");
        a.setColor("red");
        Player b = g.addPlayer("222", "bob");
        b.setFaction(g, "sol");
        b.setColor("blue");
        g.getDiscardActionCards().put("scuttle", 7);
        g.getDiscardActionCards().put("plague", 9);

        Decision d1 = build(g, msg("6001", "800", "resolve", "FFCC_hacan_resolvePlagueStep1", "deleteButtons"));
        check(d1.kind().equals("action_card.resolve"), "resolve kind " + d1.kind());
        check("plague".equals(d1.options().get(0).value().get("actionCard")), "resolve names the card " + d1.options().get(0).value());

        Decision d2 = build(g, msg("6002", "800", "scuttle", "FFCC_hacan_scuttleOn_sol_dd", "FFCC_hacan_endScuttle_sol"));
        check(d2.kind().equals("action_card.step"), "scuttle step kind " + d2.kind());
        var v2 = d2.options().get(0).value();
        check(v2 != null && "scuttle".equals(v2.get("actionCard")) && "sol".equals(v2.get("player")) && "dd".equals(v2.get("unit"))
                && "choose".equals(v2.get("role")), "scuttleOn value " + v2);
        check("done".equals(d2.options().get(1).value().get("role")), "endScuttle done " + d2.options().get(1).value());
        check("111".equals(d2.target().userId()), "step target owner " + d2.target());

        Decision d3 = build(g, msg("6003", "800", "whens", "play_when", "no_when", "no_when_persistent"));
        check(d3.kind().equals("action_card.when_after") && "table".equals(d3.scope()) && d3.window() != null
                && d3.window().eligible().size() == g.getRealPlayers().size(), "when window (realPlayers=" + g.getRealPlayers().size() + ") " + d3.kind() + " " + d3.window());
        check("pass_agenda".equals(d3.options().get(2).value().get("action")), "no_when_persistent " + d3.options().get(2).value());

        Decision d4 = build(g, msg("6004", "800", "afters", "play_after_Keleres Rider", "no_after", "no_after_persistent"));
        check(d4.kind().equals("action_card.when_after") && "after".equals(d4.window().kind()), "after window " + d4.window());
        check("Keleres Rider".equals(d4.options().get(0).value().get("rider")), "rider " + d4.options().get(0).value());

        Decision d5 = build(g, msg("6005", "800", "acq", "FFCC_sol_winnuPNPlay_3", "deleteButtons"));
        check(d5.kind().equals("promissory_note.resolve") && Integer.valueOf(3).equals(d5.options().get(0).value().get("strategyCard")),
                "acquiescence " + d5.kind() + " " + d5.options().get(0).value());

        Decision d6 = build(g, msg("6006", "800", "te", "FFCC_hacan_lieInWait", "FFCC_hacan_resolveCounterStroke_101"));
        check(d6.kind().equals("action_card.step"), "TE / counterstroke step " + d6.kind());
        check("counterstroke".equals(d6.options().get(1).value().get("actionCard")), "counterstroke card " + d6.options().get(1).value());

        Decision d7 = build(g, msg("6007", "800", "old", "FFCC_hacan_plagueStep2_sol"));
        check(d7.kind().equals("action_card.target") && "plague".equals(d7.options().get(0).value().get("actionCard")),
                "target carries card " + d7.options().get(0).value());
        System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILURES");
        System.exit(fails == 0 ? 0 : 1);
    }
}
