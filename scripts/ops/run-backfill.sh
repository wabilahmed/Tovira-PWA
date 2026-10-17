#!/usr/bin/env bash
# [P17] Run the trial backfill (apps/api/src/scripts/backfill-trials.ts) in prod, SAFELY, as a one-off
# ECS Fargate task INSIDE the VPC — so no prod DB credential ever touches your laptop and you never
# hand-build an SSM tunnel. The task uses the prod API task definition (same subnets, security groups and
# the DATABASE_URL secret the running service uses); we only override the container command to run the
# backfill instead of the server. It waits for the task, prints its CloudWatch logs, and exits with the
# task's own exit code.
#
# USAGE (with YOUR admin profile):
#   AWS_PROFILE=prospera scripts/ops/run-backfill.sh --only <userId>            # dry run (default)
#   AWS_PROFILE=prospera scripts/ops/run-backfill.sh --only <userId> --apply    # writes (guarded)
#   AWS_PROFILE=prospera scripts/ops/run-backfill.sh                            # dry run, all accounts
#   AWS_PROFILE=prospera scripts/ops/run-backfill.sh --apply --i-checked-the-dry-run
#
# --apply REFUSES unless a dry run for the SAME args succeeded in the last 30 minutes, or you pass
# --i-checked-the-dry-run. The dry run writes NOTHING (the backfill is dry-run-by-default).
#
# This script makes only read-except-run-task AWS calls; the actual DB write is done by the backfill under
# --apply, inside the task. It needs: ecs:DescribeServices, ecs:DescribeTaskDefinition, ecs:RunTask,
# iam:PassRole (task + execution role), ecs:DescribeTasks, logs:GetLogEvents.
set -euo pipefail

# --- Fixed prod coordinates (names are stable; everything else is discovered live) ---
REGION="${TOVIRA_BACKFILL_REGION:-eu-north-1}"
CLUSTER="${TOVIRA_BACKFILL_CLUSTER:-tovira-prod}"
SERVICE="${TOVIRA_BACKFILL_SERVICE:-tovira-prod-api}"
CONTAINER="${TOVIRA_BACKFILL_CONTAINER:-api}"
LOG_GROUP="${TOVIRA_BACKFILL_LOG_GROUP:-/tovira/prod/api}"
LOG_STREAM_PREFIX="${TOVIRA_BACKFILL_LOG_PREFIX:-api}"
# The in-image path (docker/api.prod.Dockerfile copies the whole apps/api tree; the app runs via tsx).
SCRIPT_IN_IMAGE="apps/api/src/scripts/backfill-trials.ts"
# Dry-run proof store + TTL for the --apply guard (overridable for tests).
STATE_DIR="${TOVIRA_BACKFILL_STATE_DIR:-${HOME}/.cache/tovira-backfill}"
DRYRUN_TTL="${TOVIRA_BACKFILL_DRYRUN_TTL:-1800}" # 30 minutes, seconds

die() { echo "run-backfill: $*" >&2; exit 2; }

# --- Parse args: --apply and --i-checked-the-dry-run are OURS; everything else passes to the backfill ---
APPLY=0
I_CHECKED=0
PASSTHROUGH=()   # args handed to the backfill script (includes --only <id> and --apply)
KEYARGS=()       # the args that define "the same run" for the guard (passthrough minus --apply)
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; PASSTHROUGH+=("$1"); shift ;;
    --i-checked-the-dry-run) I_CHECKED=1; shift ;; # consumed here, never sent to the container
    --only)
      [ "$#" -ge 2 ] || die "--only needs a userId"
      PASSTHROUGH+=("$1" "$2"); KEYARGS+=("$1" "$2"); shift 2 ;;
    --only=*) PASSTHROUGH+=("$1"); KEYARGS+=("$1"); shift ;;
    *) die "unknown argument: $1 (expected --only <userId>, --apply, --i-checked-the-dry-run)" ;;
  esac
done

# Stable key for "same args" = the non---apply args (so a dry run for --only X authorises --apply --only X).
key_for() { printf '%s\n' "${KEYARGS[*]-}" | /usr/bin/shasum 2>/dev/null | cut -d' ' -f1 || printf '%s' "${KEYARGS[*]-}" | cksum | cut -d' ' -f1; }
STAMP="${STATE_DIR}/$(key_for).dryrun"

# --- The --apply guard: require a fresh successful dry run, unless explicitly overridden ---
if [ "$APPLY" -eq 1 ] && [ "$I_CHECKED" -eq 0 ]; then
  if [ -f "$STAMP" ]; then
    now="$(date +%s)"; then_ts="$(cat "$STAMP" 2>/dev/null || echo 0)"
    age=$(( now - then_ts ))
    [ "$age" -le "$DRYRUN_TTL" ] || die "the dry run for these args is $((age/60))m old (> $((DRYRUN_TTL/60))m). Re-run WITHOUT --apply first, or pass --i-checked-the-dry-run."
  else
    die "no successful dry run recorded for these args. Run WITHOUT --apply first (it writes nothing), or pass --i-checked-the-dry-run."
  fi
fi

echo "run-backfill: cluster=$CLUSTER service=$SERVICE region=$REGION mode=$([ "$APPLY" -eq 1 ] && echo APPLY || echo 'DRY RUN')"

# --- Discover the service's CURRENT task definition + network config (so we always match the live API) ---
svc_json="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
  --query 'services[0].{taskDefinition:taskDefinition,net:networkConfiguration.awsvpcConfiguration}' --output json)"
TASKDEF="$(printf '%s' "$svc_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).taskDefinition||""))')"
SUBNETS="$(printf '%s' "$svc_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).net.subnets||[]).join(",")))')"
SGS="$(printf '%s' "$svc_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).net.securityGroups||[]).join(",")))')"
PUBIP="$(printf '%s' "$svc_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).net.assignPublicIp||"DISABLED"))')"
[ -n "$TASKDEF" ] || die "could not read the prod task definition (check AWS_PROFILE / permissions)"
[ -n "$SUBNETS" ] || die "could not read the service subnets"
echo "run-backfill: taskDefinition=$TASKDEF subnets=$SUBNETS sg=$SGS assignPublicIp=$PUBIP"

# --- Build the container command override: run the backfill via tsx instead of the server ---
CMD_JSON="$(CONTAINER="$CONTAINER" SCRIPT="$SCRIPT_IN_IMAGE" node -e '
  const args = process.argv.slice(1);
  const cmd = ["node_modules/.bin/tsx", process.env.SCRIPT, ...args];
  process.stdout.write(JSON.stringify({ containerOverrides: [{ name: process.env.CONTAINER, command: cmd }] }));
' -- ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"})"
NET_CONFIG="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SGS],assignPublicIp=$PUBIP}"
echo "run-backfill: command override → $CMD_JSON"

# --- Run the one-off task ---
run_json="$(aws ecs run-task --cluster "$CLUSTER" --region "$REGION" \
  --task-definition "$TASKDEF" --launch-type FARGATE --count 1 \
  --network-configuration "$NET_CONFIG" --overrides "$CMD_JSON" --output json)"
TASK_ARN="$(printf '%s' "$run_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const t=(j.tasks&&j.tasks[0]&&j.tasks[0].taskArn)||"";const f=(j.failures&&j.failures[0])||null;if(!t){console.error("run-task failed: "+JSON.stringify(f));process.exit(1);}console.log(t);})')"
TASK_ID="${TASK_ARN##*/}"
echo "run-backfill: started task $TASK_ID — waiting for it to stop…"

# --- Wait, then read its logs + exit code ---
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION"
desc="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION" \
  --query 'tasks[0].{reason:stoppedReason,exit:containers[0].exitCode}' --output json)"
EXIT_CODE="$(printf '%s' "$desc" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.exit==null?1:j.exit);})')"
STOP_REASON="$(printf '%s' "$desc" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reason||""))')"

echo "run-backfill: ----- task log ($LOG_GROUP : $LOG_STREAM_PREFIX/$CONTAINER/$TASK_ID) -----"
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM_PREFIX/$CONTAINER/$TASK_ID" \
  --region "$REGION" --start-from-head --output json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const e of (JSON.parse(s).events||[]))console.log(e.message)}catch{}})' || echo "(no log events yet)"
echo "run-backfill: --------------------------------------------------------------"
[ -n "$STOP_REASON" ] && echo "run-backfill: stoppedReason: $STOP_REASON"
echo "run-backfill: task exit code = $EXIT_CODE"

# --- Record a successful DRY RUN so a subsequent --apply for the same args is authorised ---
if [ "$APPLY" -eq 0 ] && [ "$EXIT_CODE" -eq 0 ]; then
  mkdir -p "$STATE_DIR"; date +%s > "$STAMP"
  echo "run-backfill: dry run OK — recorded; you have $((DRYRUN_TTL/60))m to re-run with --apply for these args."
fi

exit "$EXIT_CODE"
