#!/usr/bin/env bash
# TODO(implementation): bake extension jars into the image.
# Extension repos (plugin-apps-harness / kestra-oidc-provider / plugin-relay-dsh / plugin-apps-amis)
# each build independently (fresh clone -> build -> test). Collect their artifacts here and
# copy into the webserver classpath / plugins dir before `docker build`.
set -euo pipefail
echo "WARN: build-extensions.sh is a placeholder until extension repos carry buildable sources."
exit 0
