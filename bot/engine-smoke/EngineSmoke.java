package ti4.selfhost.engine;

import java.util.List;
import net.dv8tion.jda.api.utils.data.DataObject;
import ti4.game.Game;
import ti4.game.Player;
import ti4.selfhost.engine.EngineModels.Decision;

public class EngineSmoke {
    static void check(boolean ok, String what) {
        System.out.println((ok ? "PASS " : "FAIL ") + what);
        if (!ok) failures++;
    }

    static int failures;

    static DataObject msg(String id, String channel, int flags, String content, String... customIds) {
        StringBuilder comps = new StringBuilder("[{\"type\":1,\"components\":[");
        for (int i = 0; i < customIds.length; i++) {
            if (i > 0) comps.append(',');
            comps.append("{\"type\":2,\"style\":2,\"label\":\"L").append(i).append("\",\"custom_id\":\"")
                    .append(customIds[i]).append("\"}");
        }
        comps.append("]}]");
        return DataObject.fromJson("{\"id\":\"" + id + "\",\"channel_id\":\"" + channel + "\",\"flags\":" + flags
                + ",\"content\":\"" + content + "\",\"components\":" + comps + "}");
    }

    public static void main(String[] args) throws Exception {
        List<KindSpec> kinds = DecisionKinds.all();
        check(kinds.size() >= 4, "kind scan found " + kinds.stream().map(KindSpec::kind).toList());

        Game g = new Game();
        g.setName("pbd999");
        Player a = g.addPlayer("111", "alice");
        a.setFaction(g, "hacan");
        a.setColor("red");
        Player b = g.addPlayer("222", "bob");
        b.setFaction(g, "sol");
        b.setColor("blue");
        b.setCardsInfoThreadID("900");

        // 1. SC pick, owner prefix
        DataObject m1 = msg("5001", "800", 0, "<@111> pick a strategy card", "FFCC_hacan_scPick_1", "FFCC_hacan_scPick_7", "deleteButtons");
        Decision d1 = DecisionCapture.build(g, m1, DecisionCapture.controls(m1), null);
        check(d1.kind().equals("strategy_card.pick"), "SC pick kind = " + d1.kind());
        check("111".equals(d1.target().userId()) && "owner_prefix".equals(d1.target().resolvedBy()), "SC pick target " + d1.target());
        check(d1.options().get(1).value() != null && Integer.valueOf(7).equals(d1.options().get(1).value().get("strategyCard")), "SC value " + d1.options().get(1).value());
        check(d1.options().get(2).value() == null, "Done option untyped");
        check("player".equals(d1.scope()) && "public".equals(d1.visibility()), "scope/visibility " + d1.scope() + "/" + d1.visibility());

        // 2. SO discard in bob's cards-info thread, no owner prefix
        DataObject m2 = msg("5002", "900", 0, "discard one", "discardSecret_3", "discardSecret_4");
        Decision d2 = DecisionCapture.build(g, m2, DecisionCapture.controls(m2), null);
        check(d2.kind().equals("secret_objective.discard"), "SO kind = " + d2.kind());
        check("222".equals(d2.target().userId()) && "cards_thread".equals(d2.target().resolvedBy()), "SO target " + d2.target());
        check("private".equals(d2.visibility()), "SO private");

        // 3. Starting tech without owner, mention of alice
        DataObject m3 = msg("5003", "800", 0, "<@111> choose your starting tech", "getTech_amd__noPay__comp");
        Decision d3 = DecisionCapture.build(g, m3, DecisionCapture.controls(m3), null);
        check(d3.kind().equals("tech.gain") && Boolean.TRUE.equals(d3.options().get(0).value().get("free")), "tech " + d3.options().get(0).value());
        check("mention".equals(d3.target().resolvedBy()), "tech target by mention " + d3.target());

        // 4. Follow window (typed by G2 since engine-int) and a legacy prompt with no target
        DataObject m4 = msg("5004", "800", 0, "anyone follow?", "sc_follow_5", "sc_no_follow_5");
        Decision d4 = DecisionCapture.build(g, m4, DecisionCapture.controls(m4), null);
        check(d4.kind().equals("strategy_card.resolve") && "table".equals(d4.scope()), "follow window " + d4.kind() + " " + d4.scope());
        DataObject m4b = msg("5005", "800", 0, "anything", "someUntypedThing_1", "anotherUntyped");
        Decision d4b = DecisionCapture.build(g, m4b, DecisionCapture.controls(m4b), null);
        check(d4b.kind().equals("legacy") && d4b.target().userId() == null, "legacy " + d4b.kind() + " " + d4b.target() + " " + d4b.scope());

        // 5. Registry: open, edit in place = same id revision 2, close
        Decision o1 = DecisionRegistry.open(d1);
        check(o1.revision() == 1 && o1.seq() > 0, "opened rev 1 seq " + o1.seq());
        DataObject m1b = msg("5001", "800", 0, "<@111> pick a strategy card", "FFCC_hacan_scPick_7", "deleteButtons");
        Decision d1b = DecisionCapture.build(g, m1b, DecisionCapture.controls(m1b), null);
        Decision o2 = DecisionRegistry.open(d1b);
        check(o2.id().equals(o1.id()) && o2.revision() == 2, "edit in place keeps id, rev " + o2.revision());
        check(DecisionCapture.build(g, m1b, DecisionCapture.controls(m1b), null) == null, "identical re-edit ignored");
        DecisionRegistry.closeByMessage("5001", "deleted");
        check(DecisionRegistry.get(o1.id()) == null, "closed");
        var events = DecisionRegistry.since(0, "pbd999");
        check(events.size() == 3 && events.get(0).type().equals("decision.opened") && events.get(1).type().equals("decision.updated") && events.get(2).type().equals("decision.closed"), "event log " + events.stream().map(EngineModels.EngineEvent::type).toList());

        // 6. State snapshot
        EngineModels.GameState st = StateSnapshotBuilder.build(g, "111");
        check(st.players().size() == 2 && "hacan".equals(st.players().get(0).faction()) && st.players().get(0).hand() != null && st.players().get(1).hand() == null, "state players/hand");

        // 6b. Obsolete prompts are not typed (c12 closes them at capture): the round's objective is already revealed
        g.setStoredValue("revealedPOInRound" + g.getRound(), "x");
        DataObject m6 = msg("5006", "800", 0, "reveal", "reveal_stage_1", "reveal_stage_2");
        Decision d6 = DecisionCapture.build(g, m6, DecisionCapture.controls(m6), null);
        check(d6 == null || d6.kind().equals("legacy"), "stale reveal prompt is closed at capture (c12) or stays legacy: " + (d6 == null ? null : d6.kind()));
        g.setStoredValue("revealedPOInRound" + g.getRound(), "");

        // 6c. tech.gain without owner prefix or mention: the player the prompt text names
        DataObject m7 = msg("5007", "800", 0, "<:hacan:1> **red** use the buttons to choose your starting technology:", "getTech_amd__noPay__comp", "getTech_det__noPay__comp");
        Decision d7 = DecisionCapture.build(g, m7, DecisionCapture.controls(m7), null);
        check(d7.kind().equals("tech.gain") && d7.target() != null && "111".equals(d7.target().userId()), "tech.gain target from prompt text " + d7.target());

        // 7. Answer bodies deserialize through the records' canonical constructors (Jackson 3, as Spring Boot 4 does)
        var mapper = tools.jackson.databind.json.JsonMapper.builder().build();
        var r1 = mapper.readValue("{\"optionId\":\"x\",\"expectedSeq\":3}", EngineModels.AnswerRequest.class);
        check("x".equals(r1.optionId()) && r1.expectedSeq() == 3 && r1.payload() == null && r1.values() == null, "AnswerRequest option " + r1);
        var r2 = mapper.readValue("{\"payload\":{\"tg\":2,\"planets\":[\"mr\"]},\"values\":[\"a\"],\"inputs\":{\"n\":\"1\"}}", EngineModels.AnswerRequest.class);
        check(r2.payload() != null && Integer.valueOf(2).equals(r2.payload().get("tg")) && r2.values().equals(List.of("a")) && "1".equals(r2.inputs().get("n")), "AnswerRequest payload/values/inputs " + r2);

        System.out.println(failures == 0 ? "ALL PASS" : failures + " FAILURES");
        System.exit(failures == 0 ? 0 : 1);
    }
}
