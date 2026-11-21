#!/usr/bin/env bash
# Run before enabling the local-workdir wrapper on a Dev Pipeline runtime.
set -euo pipefail
source_dir=$(realpath "${1:?pass the multica-local-workdir checkout}")
expected=888ccb00953d722e912f812edb1f4141089d36a9
[[ $(git -C "$source_dir" rev-parse HEAD) == "$expected" ]]
git -C "$source_dir" diff --quiet HEAD -- claude bin
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir -p "$temp/project" "$temp/wrapper/logs" "$temp/native"
cp -r "$source_dir/bin" "$source_dir/claude" "$temp/wrapper/"
cat > "$temp/native/multica" <<'CLI'
#!/bin/bash
echo native-cli
CLI
cat > "$temp/probe" <<'PROBE'
#!/bin/bash
set -eu
[[ "$PWD" == "$LOCAL_WORKING_PATH" ]]
if [[ "$MULTICA_AGENT_NAME" == wrapper_control ]]; then
    [[ "${LWD_AGENT_RUN:-}" == 1 && "$MULTICA_CLI_PATH" != "$NATIVE_CLI" ]]
else
    [[ -z "${LWD_AGENT_RUN:-}" && "$MULTICA_CLI_PATH" == "$NATIVE_CLI" ]]
    [[ "$(command -v multica)" == "$NATIVE_CLI" ]]
    [[ "$("$MULTICA_CLI_PATH" issue status ficticia done)" == native-cli ]]
fi
PROBE
chmod +x "$temp/probe" "$temp/native/multica"
for agent in dev_pipeline_triagem dev_pipeline_arquiteto dev_pipeline_executor dev_pipeline_qa dev_pipeline_entrega wrapper_control; do
    env -i HOME="$temp" PATH="$temp/native:/usr/bin:/bin" MULTICA_AGENT_NAME="$agent" \
        LWD_GATE_AGENTS=wrapper_control MULTICA_CLI_PATH="$temp/native/multica" \
        NATIVE_CLI="$temp/native/multica" LOCAL_WORKING_PATH="$temp/project" \
        CLAUDE_BIN="$temp/probe" bash "$temp/wrapper/claude"
done
echo 'Cinco agentes usam o CLI nativo. O controle positivo usa o shim.'
