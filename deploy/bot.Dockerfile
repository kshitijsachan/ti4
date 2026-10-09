# syntax=docker/dockerfile:1.7
# AsyncTI4 bot (rules engine) for TI4 Online. Build context: the repo root.
#   docker build -f deploy/bot.Dockerfile -t ti4-bot .
# Multi-arch: every base image here has linux/amd64 and linux/arm64 variants (Oracle Ampere works).
#
# Build-time only (never ends up in the image): if you build behind a TLS-intercepting proxy, pass
#   --build-arg HTTPS_PROXY=... --secret id=build_ca,src=/path/to/proxy-ca.crt
# (see deploy/local-proxy-build.sh). Normal builds need neither.

ARG MAVEN_IMAGE=maven:3.9-eclipse-temurin-26
ARG JRE_IMAGE=eclipse-temurin:26-jre

# ---- 1. upstream source at the pinned commit + our patches ----
# Art/data (src/main/resources, ~900MB) ships beside the jar in /opt/resources, not inside it.
FROM ${MAVEN_IMAGE} AS src
WORKDIR /build
COPY bot/UPSTREAM_COMMIT bot/fetch-upstream.sh bot/
COPY bot/patches bot/patches
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export GIT_SSL_CAINFO=/run/secrets/build_ca; fi; \
    sh bot/fetch-upstream.sh /build/upstream \
 && rm -rf /build/upstream/.git \
 && mv /build/upstream/src/main/resources /build/resources \
 && mkdir -p /build/upstream/src/main/resources \
 && cp -r /build/resources/config /build/resources/logback.xml /build/upstream/src/main/resources/

# ---- 2. compile ----
FROM ${MAVEN_IMAGE} AS build
WORKDIR /opt/app
COPY --chmod=755 deploy/mvn-build.sh /usr/local/bin/mvn-build
COPY --from=src /build/upstream/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 --mount=type=secret,id=build_ca,required=false \
    mvn-build -DskipTests dependency:go-offline
COPY --from=src /build/upstream/ ./
RUN --mount=type=cache,target=/root/.m2 --mount=type=secret,id=build_ca,required=false \
    mvn-build -Dspotless.skip=true -Dmaven.test.skip=true clean package \
 && cp target/TI4_map_generator_discord_bot-1.0-SNAPSHOT.jar /opt/tibot.jar

# ---- 3. runtime ----
FROM ${JRE_IMAGE}
# fontconfig + DejaVu (needed for map rendering) are already in the temurin image.
RUN groupadd -g 10001 tibot && useradd -u 10001 -g tibot -M -d /opt/STORAGE -s /usr/sbin/nologin tibot \
 && mkdir -p /opt/STORAGE && chown tibot:tibot /opt/STORAGE
COPY --from=src /build/resources /opt/resources
COPY --from=build /opt/tibot.jar /app/tibot.jar
COPY --chmod=755 deploy/bot-entrypoint.sh /app/entrypoint.sh
COPY --chmod=755 deploy/bot-healthcheck.sh /app/healthcheck.sh

ENV DB_PATH=/opt/STORAGE \
    RESOURCE_PATH=/opt/resources \
    SHIM_STATE_FILE=/shim-data/state.json \
    JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:InitialRAMPercentage=20.0 -XX:+UseStringDeduplication -XX:+ExitOnOutOfMemoryError"
WORKDIR /app
USER tibot
EXPOSE 8081
VOLUME ["/opt/STORAGE"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m --retries=5 CMD ["/app/healthcheck.sh"]
ENTRYPOINT ["/app/entrypoint.sh"]
