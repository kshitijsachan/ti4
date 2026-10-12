#!/bin/bash
# Offline engine checks against engine-int target/classes (+ the running jar's libs). No services touched.
#   run.sh            -> EngineSmoke + InteractionSmoke
#   run.sh overlap    -> KindOverlap over messages.tsv (classification replay of recorded shim messages)
S=${S:-/tmp/claude-0/-home-user-ti4/a14f22bb-e2a7-521d-b59d-8f5dc12062ca/scratchpad}  # needs $S/libs/BOOT-INF/lib (unpacked bot jar libs)
T=$(cd "$(dirname "$0")" && pwd)
J=/home/user/tools/jdk-26.0.2+10/bin
W=${W:-/home/user/asyncti4/engine-int}
CP=$W/target/classes:$(ls $S/libs/BOOT-INF/lib/*.jar | tr '\n' ':')
OUT=$(mktemp -d); trap "rm -rf $OUT" EXIT
# JUnit tests under ti4/selfhost are skipped (no junit in the jar libs); the smoke helpers are plain classes.
$J/javac -proc:none -nowarn -cp "$CP" -d $OUT $T/*.java $(find $W/src/test/java/ti4/selfhost -name "*.java" -exec grep -L "org.junit" {} +) 2>&1 | grep -v "^Note:\|JAVA_TOOL" | head -20
cd $W
if [ "$1" = overlap ]; then
  timeout 300 $J/java -cp "$OUT:$CP" ti4.selfhost.engine.KindOverlap ${MESSAGES:-$S/int-smoke/messages.tsv} 2>&1 | grep -v "^Info\|JAVA_TOOL\|Reflections"
  exit
fi
for M in ti4.selfhost.engine.EngineSmoke ti4.selfhost.engine.interaction.InteractionSmoke ti4.selfhost.engine.CardsTailSmoke; do
  echo "== $M"
  timeout 300 $J/java -cp "$OUT:$CP" $M 2>&1 | grep -E "PASS|FAIL|Exception|at ti4|ALL|FAILURES|passed|failed" | grep -v "kind scan found" | head -60
done
