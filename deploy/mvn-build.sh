#!/bin/sh
# Build-stage helper for deploy/bot.Dockerfile: runs mvn, adding a proxy + extra CA only when the build
# was given HTTPS_PROXY (a predefined build arg) and/or the optional build_ca secret. Never used at runtime.
set -e
ARGS=""
if [ -n "${HTTPS_PROXY:-}" ]; then
  hp=${HTTPS_PROXY#*://}; hp=${hp%%/*}; host=${hp%:*}; port=${hp##*:}
  cat > /tmp/proxy-settings.xml <<XML
<settings><proxies><proxy><id>build</id><active>true</active><protocol>https</protocol>
<host>$host</host><port>$port</port></proxy></proxies></settings>
XML
  ARGS="-s /tmp/proxy-settings.xml"
fi
if [ -s /run/secrets/build_ca ]; then
  cp "$JAVA_HOME/lib/security/cacerts" /tmp/truststore
  keytool -importcert -noprompt -alias build-ca -file /run/secrets/build_ca \
    -keystore /tmp/truststore -storepass changeit >/dev/null
  MAVEN_OPTS="${MAVEN_OPTS:-} -Djavax.net.ssl.trustStore=/tmp/truststore -Djavax.net.ssl.trustStorePassword=changeit"
  export MAVEN_OPTS
fi
# shellcheck disable=SC2086
exec mvn -B -ntp $ARGS "$@"
