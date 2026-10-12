package ti4.selfhost.engine;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import ti4.discord.interactions.routing.ComponentIdEnvelope;

/**
 * Offline classification replay: every distinct button set recorded by the shim → DecisionKinds.classify, plus every
 * handler id matched by 2+ kinds (overlaps). Usage: KindOverlap messages.tsv
 */
public class KindOverlap {
    public static void main(String[] args) throws Exception {
        List<KindSpec> kinds = DecisionKinds.all();
        Map<String, Integer> byKind = new TreeMap<>();
        Map<String, Set<String>> overlaps = new TreeMap<>();
        Map<String, String> wonBy = new HashMap<>();
        int msgs = 0;
        for (String line : Files.readAllLines(Path.of(args[0]))) {
            if (line.isBlank()) continue;
            msgs++;
            List<String> hs = new ArrayList<>();
            List<DecisionCapture.RawControl> raw = new ArrayList<>();
            for (String c : line.split("\t")) {
                hs.add(ComponentIdEnvelope.decode(c).handlerId());
                raw.add(new DecisionCapture.RawControl(c, "", "secondary", null, false, null));
            }
            if (DecisionCapture.isInfoMenu(raw, hs)) {
                byKind.merge("(info menu: not a decision)", 1, Integer::sum);
                continue;
            }
            KindSpec k = DecisionKinds.classify(hs);
            String kn = k == null ? "legacy" : k.kind();
            byKind.merge(kn, 1, Integer::sum);
            for (String h : hs) {
                if (h == null) continue;
                List<String> m = new ArrayList<>();
                for (KindSpec s : kinds) if (s.matches(h)) m.add(s.kind() + "@" + s.priority());
                if (m.size() > 1) {
                    String key = h.replaceAll("\\d+", "N");
                    overlaps.computeIfAbsent(key, x -> new TreeSet<>()).addAll(m);
                    wonBy.put(key, kn);
                }
            }
        }
        int info = byKind.getOrDefault("(info menu: not a decision)", 0);
        int legacy = byKind.getOrDefault("legacy", 0);
        int decisions = msgs - info;
        System.out.printf("messages: %d, info menus: %d, decisions: %d, typed: %d (%.1f%% of decisions)%n",
                msgs, info, decisions, decisions - legacy, 100.0 * (decisions - legacy) / Math.max(1, decisions));
        byKind.forEach((k, n) -> System.out.println("  " + n + "\t" + k));
        System.out.println("handler ids matched by 2+ kinds (pattern -> kinds; message classified as):");
        overlaps.forEach((h, ks) -> System.out.println("  " + h + " -> " + ks + "; msg=" + wonBy.get(h)));
    }
}
